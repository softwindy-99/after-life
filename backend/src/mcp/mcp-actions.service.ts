import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { MoreThan, Repository } from 'typeorm';
import { LetterService } from 'src/letter/letter.service';
import { User } from 'src/user/user.entity';
import { ResourceService, UploadedResource } from 'src/resource/resource.service';
import { CheckInService } from 'src/check-in/check-in.service';
import { CheckIn } from 'src/check-in/check-in.entity';
import { Auth } from 'src/auth/auth.entity';
import { McpActivity } from './mcp-activity.entity';
import { McpPrincipal } from './mcp.types';
import { UpdateMcpLetterDraft } from 'src/letter/letter.types';

@Injectable()
export class McpActionsService {
  constructor(
    private readonly letters: LetterService,
    private readonly resources: ResourceService,
    private readonly checkIns: CheckInService,
    private readonly jwt: JwtService,
    @InjectRepository(McpActivity) private readonly activities: Repository<McpActivity>,
    @InjectRepository(Auth) private readonly auths: Repository<Auth>,
  ) {}

  async readContent(
    userUuid: string,
    letterUuid: string,
    offset: number,
    expectedUpdatedAt?: string,
  ): Promise<object> {
    const letter = await this.letters.findOwnedOne(letterUuid, userUuid);
    if (!letter) throw new NotFoundException('letter not found');
    if (expectedUpdatedAt && letter.updatedAt.toISOString() !== expectedUpdatedAt)
      throw new ConflictException('resource changed; restart reading');
    const content = letter.content.slice(offset, offset + 20000);
    return {
      content,
      offset,
      nextOffset: offset + content.length < letter.content.length ? offset + content.length : null,
      totalLength: letter.content.length,
      contentFormat: letter.contentFormat,
      updatedAt: letter.updatedAt.toISOString(),
    };
  }

  async createLetter(
    userUuid: string,
    input: {
      title: string;
      content: string;
      contentFormat: string;
      contactUuids?: string[];
      inactiveAfterMinutes?: number | null;
    },
  ): Promise<object> {
    // New letters always start disabled. Enabling is a separate preview/commit operation.
    const letter = await this.letters.insert({
      ...input,
      contacts: input.contactUuids?.map((uuid) => ({ uuid })),
      user: { uuid: userUuid },
      deliveryEnabled: false,
    });
    return {
      letterUuid: letter.uuid,
      updatedAt: letter.updatedAt.toISOString(),
      deliveryEnabled: false,
    };
  }

  async updateLetter(
    principal: McpPrincipal,
    letterUuid: string,
    expectedUpdatedAt: string,
    input: UpdateMcpLetterDraft,
  ): Promise<object> {
    if (!Object.values(input).some((value) => value !== undefined))
      throw new BadRequestException('at least one letter field is required');
    const { contactUuids, ...fields } = input;
    const letter = await this.letters.updateOwned(
      letterUuid,
      principal.uuid,
      { ...fields, contacts: contactUuids?.map((uuid) => ({ uuid })) },
      { expectedUpdatedAt, allowEnabled: principal.mcpScopes.includes('mcp:delivery:write') },
    );
    if (!letter) throw new NotFoundException('letter not found');
    return {
      letterUuid: letter.uuid,
      updatedAt: letter.updatedAt.toISOString(),
      deliveryEnabled: letter.deliveryEnabled,
    };
  }

  async previewDelivery(
    principal: McpPrincipal,
    letterUuid: string,
    inactiveAfterMinutes: number,
  ): Promise<object> {
    await this.limitPending(principal);
    const letter = await this.letters.findOwnedOne(letterUuid, principal.uuid);
    if (!letter) throw new NotFoundException('letter not found');
    if (letter.lastTriggeredAt) throw new ConflictException('delivered letters cannot be enabled');
    const user = await this.activities.manager
      .getRepository(User)
      .findOne({ where: { uuid: principal.uuid, iSdelete: 0 } });
    const { lastSeenAt } = await this.checkIns.getStatus(principal.uuid);
    const dueAt = new Date((lastSeenAt ?? user.createdAt).getTime() + inactiveAfterMinutes * 60000);
    const recipients = letter.contacts.filter((contact) => contact.iSdelete !== 1 && contact.email);
    if (!recipients.length)
      throw new BadRequestException('at least one recipient email is required');
    const overdue = dueAt.getTime() <= Date.now();
    const preview = await this.activities.save(
      this.activities.create({
        user,
        authUuid: principal.authUuid,
        tool: 'afterlife_preview_delivery',
        resourceUuid: letterUuid,
        outcome: overdue ? 'pending' : 'ready',
        expiresAt: new Date(Date.now() + 10 * 60000),
        details: {
          expectedUpdatedAt: letter.updatedAt.toISOString(),
          inactiveAfterMinutes,
          dueAt: dueAt.toISOString(),
          resourceCount: letter.resourceCount,
          contactCount: recipients.length,
        },
      }),
    );
    return {
      previewUuid: preview.uuid,
      expectedUpdatedAt: letter.updatedAt.toISOString(),
      dueAt: dueAt.toISOString(),
      requiresHumanApproval: overdue,
      expiresAt: preview.expiresAt.toISOString(),
      recipients: recipients.map((contact) => ({
        uuid: contact.uuid,
        name: contact.name,
        email: contact.email,
      })),
      resourceCount: letter.resourceCount,
      message: overdue
        ? '已超时。请用户在 AI 接入页面核对信件、联系人和附件并批准，随后使用此预览提交。'
        : '请核对投递影响后使用此预览提交。',
    };
  }

  async setDelivery(
    principal: McpPrincipal,
    letterUuid: string,
    expectedUpdatedAt: string,
    enabled: boolean,
    previewUuid?: string,
  ): Promise<object> {
    const letter = await this.letters.updateOwned(
      letterUuid,
      principal.uuid,
      { deliveryEnabled: enabled },
      {
        expectedUpdatedAt,
        allowEnabled: true,
        beforeWrite: async (manager, current) => {
          if (!enabled) return;
          const repo = manager.getRepository(McpActivity);
          const preview = previewUuid
            ? await repo.findOne({
                where: {
                  uuid: previewUuid,
                  resourceUuid: letterUuid,
                  authUuid: principal.authUuid,
                  user: { uuid: principal.uuid },
                  iSdelete: 0,
                },
                lock: { mode: 'pessimistic_write' },
              })
            : null;
          if (
            !preview ||
            !['ready', 'approved'].includes(preview.outcome) ||
            !preview.expiresAt ||
            preview.expiresAt.getTime() <= Date.now() ||
            preview.details?.expectedUpdatedAt !== current.updatedAt.toISOString()
          )
            throw new ConflictException('a fresh, authorized delivery preview is required');
          const minutes = preview.details.inactiveAfterMinutes;
          if (!minutes) throw new ConflictException('invalid preview');
          const last = await manager.getRepository(CheckIn).findOne({
            where: { user: { uuid: principal.uuid }, iSdelete: 0 },
            order: { checkedAt: 'DESC' },
          });
          const user = await manager
            .getRepository(User)
            .findOne({ where: { uuid: principal.uuid, iSdelete: 0 } });
          if (
            preview.outcome !== 'approved' &&
            (last?.checkedAt ?? user.createdAt).getTime() + minutes * 60000 <= Date.now()
          )
            throw new ConflictException(
              'now overdue; create another preview and obtain human approval',
            );
          current.inactiveAfterMinutes = minutes;
          preview.outcome = 'consumed';
          await repo.save(preview);
        },
      },
    );
    if (!letter) throw new NotFoundException('letter not found');
    return {
      letterUuid: letter.uuid,
      deliveryEnabled: letter.deliveryEnabled,
      inactiveAfterMinutes: letter.inactiveAfterMinutes,
      updatedAt: letter.updatedAt.toISOString(),
    };
  }

  async listResources(
    userUuid: string,
    letterUuid: string,
    page: number,
    pageSize: number,
  ): Promise<object> {
    return this.resources.listOwnedForLetter(userUuid, letterUuid, page, pageSize);
  }
  async accessResource(userUuid: string, uuid: string): Promise<object> {
    return this.resources.ownerAccess(uuid, userUuid);
  }

  async prepareUpload(
    principal: McpPrincipal,
    input: { filename: string; mimeType: string; sizeBytes: number },
  ): Promise<object> {
    await this.limitPending(principal);
    const user = await this.activities.manager
      .getRepository(User)
      .findOne({ where: { uuid: principal.uuid, iSdelete: 0 } });
    const event = await this.activities.save(
      this.activities.create({
        user,
        authUuid: principal.authUuid,
        tool: 'resource_upload',
        outcome: 'ready',
        expiresAt: new Date(Date.now() + 5 * 60000),
        details: null,
      }),
    );
    const ticket = await this.jwt.signAsync(
      { ...input, userUuid: principal.uuid, authUuid: principal.authUuid, eventUuid: event.uuid },
      { audience: 'mcp-upload', expiresIn: 300 },
    );
    return {
      uploadPath: '/mcp-files',
      headers: { Authorization: `Bearer ${ticket}` },
      method: 'POST',
      multipartField: 'file',
      expiresAt: event.expiresAt.toISOString(),
      maxBytes: 10 * 1024 * 1024,
    };
  }

  async validateUploadTicket(ticket: string): Promise<{
    userUuid: string;
    authUuid: string;
    eventUuid: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }> {
    let payload: {
      userUuid: string;
      authUuid: string;
      eventUuid: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    };
    try {
      payload = await this.jwt.verifyAsync(ticket, { audience: 'mcp-upload' });
    } catch {
      throw new ForbiddenException('upload ticket expired or invalid');
    }
    const grant = await this.auths.findOne({
      where: { uuid: payload.authUuid, iSdelete: 0, user: { uuid: payload.userUuid, iSdelete: 0 } },
      relations: { user: { role: { permissions: true } } },
    });
    if (
      !grant?.mcpScopes?.includes('mcp:resources:write') ||
      grant.user?.role?.iSdelete !== 0 ||
      !grant.user.role.permissions.some(
        (permission) => permission.iSdelete === 0 && permission.name === 'self',
      ) ||
      (grant.mcpExpiresAt && grant.mcpExpiresAt.getTime() <= Date.now())
    )
      throw new ForbiddenException('upload permission was revoked');
    const pending = await this.activities.findOne({
      where: {
        uuid: payload.eventUuid,
        authUuid: payload.authUuid,
        user: { uuid: payload.userUuid },
        tool: 'resource_upload',
        outcome: 'ready',
        expiresAt: MoreThan(new Date()),
        iSdelete: 0,
      },
    });
    if (!pending) throw new ForbiddenException('upload ticket expired or already used');
    return payload;
  }

  async upload(ticket: string, file?: UploadedResource): Promise<object> {
    const payload = await this.validateUploadTicket(ticket);
    if (!file || file.buffer.length !== payload.sizeBytes || file.size !== payload.sizeBytes)
      throw new BadRequestException('upload size does not match ticket');
    const claimed = await this.activities.update(
      { uuid: payload.eventUuid, authUuid: payload.authUuid, outcome: 'ready' },
      { outcome: 'consumed' },
    );
    if (claimed.affected !== 1) throw new ConflictException('upload ticket already used');
    return this.resources.upload(payload.userUuid, {
      ...file,
      originalname: payload.filename,
      mimetype: payload.mimeType,
    });
  }

  private async limitPending(principal: McpPrincipal): Promise<void> {
    const count = await this.activities.count({
      where: { authUuid: principal.authUuid, expiresAt: MoreThan(new Date()), outcome: 'ready' },
    });
    const pending = await this.activities.count({
      where: { authUuid: principal.authUuid, expiresAt: MoreThan(new Date()), outcome: 'pending' },
    });
    if (count + pending >= 20)
      throw new BadRequestException('too many outstanding requests; wait for expiry');
  }

  async recordCheckIn(
    principal: McpPrincipal,
    eventId: string,
    occurredAt: string,
  ): Promise<object> {
    return this.checkIns.createDelegated(principal.uuid, principal.authUuid, eventId, occurredAt);
  }
}
