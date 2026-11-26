import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
import { Auth } from 'src/auth/auth.entity';
import { AuthService } from 'src/auth/auth.service';
import { McpScope } from 'src/auth/auth.d';
import { MCP_MANAGED_SCOPES } from 'src/auth/auth-token';
import { LetterService } from 'src/letter/letter.service';
import { toLetterDto } from 'src/letter/letter.dto';
import { ResourceService } from 'src/resource/resource.service';
import { Resource } from 'src/resource/resource.entity';
import { CheckIn } from 'src/check-in/check-in.entity';
import { McpActivity } from './mcp-activity.entity';
import { User } from 'src/user/user.entity';
import { Letter } from 'src/letter/letter.entity';
import { lockOwnedUser } from 'src/correspondence/transaction';

export const mcpPermissionOptions = [
  {
    scope: 'mcp:letters:read',
    label: '读取信件',
    risk: '可获取信件标题、正文、检测规则和附件引用。',
  },
  { scope: 'mcp:contacts:read', label: '读取联系人', risk: '可获取联系人姓名、邮箱、电话和备注。' },
  {
    scope: 'mcp:resources:read',
    label: '读取附件',
    risk: '可下载私有附件；内容可能进入 AI 服务的处理范围。',
  },
  {
    scope: 'mcp:letters:write',
    label: '编辑信件',
    risk: '可新建信件、修改正文和绑定联系人；编辑已启用信件还需要检测管理权限。',
  },
  {
    scope: 'mcp:contacts:write',
    label: '管理联系人',
    risk: '可新增和修改联系方式；影响已启用信件的地址修改还需要检测管理权限。',
  },
  {
    scope: 'mcp:resources:write',
    label: '上传附件',
    risk: '可上传私有文件，占用存储额度；替换或移除附件还需要信件编辑权限。',
  },
  {
    scope: 'mcp:delivery:write',
    label: '管理检测与自动投递',
    risk: '可开关检测和调整时限，改变实际投递内容或收件人；已超时的启用请求需在本页确认。',
  },
  {
    scope: 'mcp:check-in:write',
    label: '根据人类交互辅助签到',
    risk: '信任此 agent 报告近期真人交互，会推迟自动投递。普通 MCP 无法独立证明真人在场；后台运行不得续期。',
  },
] as const;

@Injectable()
export class McpSettingsService {
  constructor(
    @InjectRepository(Auth) private readonly auths: Repository<Auth>,
    @InjectRepository(McpActivity) private readonly activities: Repository<McpActivity>,
    private readonly authService: AuthService,
    private readonly letters: LetterService,
    private readonly resources: ResourceService,
  ) {}

  async getSettings(userUuid: string, page = 1): Promise<object> {
    const grants = await this.auths.find({
      where: { user: { uuid: userUuid }, token: Like('mcp:%'), iSdelete: 0 },
      order: { createdAt: 'DESC' },
    });
    const [events, total] = await this.activities.findAndCount({
      where: { user: { uuid: userUuid }, iSdelete: 0 },
      order: { id: 'DESC' },
      skip: (page - 1) * 30,
      take: 30,
    });
    const pending = await this.activities.find({
      where: { user: { uuid: userUuid }, outcome: 'pending', iSdelete: 0 },
      order: { id: 'DESC' },
      take: 50,
    });
    const lastCheckIns = await Promise.all(
      grants.map((grant) =>
        this.activities.manager.getRepository(CheckIn).findOne({
          where: { user: { uuid: userUuid }, source: `mcp:${grant.uuid}`, iSdelete: 0 },
          order: { checkedAt: 'DESC' },
        }),
      ),
    );
    const historical = await this.auths.find({
      where: { user: { uuid: userUuid }, uuid: In(events.map((event) => event.authUuid)) },
      select: { uuid: true, mcpName: true },
    });
    const names = new Map(
      historical.map((grant) => [grant.uuid, grant.mcpName || '旧版 MCP 授权']),
    );
    return {
      permissions: mcpPermissionOptions,
      grants: grants.map((grant, index) => ({
        uuid: grant.uuid,
        name: grant.mcpName || '旧版 MCP 授权',
        scopes: grant.mcpScopes,
        legacy: !grant.mcpScopes,
        expiresAt: grant.mcpExpiresAt,
        lastUsedAt: grant.mcpLastUsedAt,
        createdAt: grant.createdAt,
        lastCheckInAt: lastCheckIns[index]?.checkedAt ?? null,
      })),
      events: events.map((event) => ({
        ...this.toEvent(event),
        agentName: names.get(event.authUuid) ?? event.authUuid,
      })),
      pending: pending
        .filter(
          (event) =>
            event.expiresAt &&
            event.expiresAt.getTime() > Date.now() &&
            grants.some(
              (grant) =>
                grant.uuid === event.authUuid &&
                (!grant.mcpExpiresAt || grant.mcpExpiresAt.getTime() > Date.now()) &&
                grant.mcpScopes?.includes('mcp:delivery:write'),
            ),
        )
        .map((event) => this.toEvent(event)),
      page,
      total,
    };
  }

  async create(
    userUuid: string,
    input: { name: string; scopes: McpScope[]; days: number | null },
  ): Promise<object> {
    const count = await this.auths.count({
      where: { user: { uuid: userUuid }, token: Like('mcp:%'), iSdelete: 0 },
    });
    if (count >= 50) throw new BadRequestException('最多保留 50 个授权，请撤销不再使用的授权。');
    return this.authService.issueMcpToken(userUuid, 'read', input);
  }

  async update(
    userUuid: string,
    uuid: string,
    input: { name: string; scopes: McpScope[] },
  ): Promise<void> {
    const grant = await this.requireGrant(userUuid, uuid);
    if (!grant.mcpScopes) throw new ConflictException('请撤销旧版授权并重新创建，以明确设置权限。');
    await this.auths.update(
      { id: grant.id, iSdelete: 0 },
      { mcpName: input.name, mcpScopes: ['mcp:read', ...input.scopes] },
    );
    // Permission changes invalidate every outstanding preview/approval.
    await this.activities.update({ authUuid: uuid, outcome: 'pending' }, { outcome: 'expired' });
    await this.activities.update({ authUuid: uuid, outcome: 'approved' }, { outcome: 'expired' });
    await this.activities.update({ authUuid: uuid, outcome: 'ready' }, { outcome: 'expired' });
  }

  async revoke(userUuid: string, uuid: string): Promise<void> {
    const grant = await this.requireGrant(userUuid, uuid);
    await this.auths.update({ id: grant.id, iSdelete: 0 }, { iSdelete: 1, token: '' });
  }

  async revokeAll(userUuid: string): Promise<void> {
    await this.authService.revokeMcpTokens(userUuid);
  }

  async getApproval(userUuid: string, uuid: string): Promise<object> {
    const event = await this.activities.findOne({
      where: {
        uuid,
        user: { uuid: userUuid },
        tool: 'afterlife_preview_delivery',
        outcome: 'pending',
        iSdelete: 0,
      },
    });
    if (!event?.expiresAt || event.expiresAt.getTime() <= Date.now())
      throw new ConflictException('请求已过期。');
    const letter = await this.letters.findOwnedOne(event.resourceUuid, userUuid);
    if (!letter || letter.updatedAt.toISOString() !== event.details?.expectedUpdatedAt)
      throw new ConflictException('信件或联系人已改变，请让 agent 重新预览。');
    const files = await this.activities.manager.getRepository(Resource).find({
      where: { letter: { id: letter.id }, user: { uuid: userUuid }, iSdelete: 0 },
      order: { id: 'ASC' },
    });
    return {
      event: this.toEvent(event),
      letter: toLetterDto(letter),
      resources: files.map((file) => ({
        uuid: file.uuid,
        filename: file.filename,
        sizeBytes: Number(file.sizeBytes),
        url: this.resources.signedPath(file.uuid, 15 * 60),
      })),
    };
  }

  async approve(userUuid: string, uuid: string, approve: boolean): Promise<void> {
    await this.activities.manager.transaction(async (manager) => {
      await lockOwnedUser(manager.getRepository(User), userUuid);
      const repo = manager.getRepository(McpActivity);
      const event = await repo.findOne({
        where: { uuid, user: { uuid: userUuid }, outcome: 'pending', iSdelete: 0 },
        lock: { mode: 'pessimistic_write' },
      });
      if (!event || !event.expiresAt || event.expiresAt.getTime() <= Date.now())
        throw new ConflictException('请求已过期，请让 agent 重新预览。');
      const grant = await manager
        .getRepository(Auth)
        .findOne({ where: { uuid: event.authUuid, user: { uuid: userUuid }, iSdelete: 0 } });
      if (
        !grant?.mcpScopes?.includes('mcp:delivery:write') ||
        (grant.mcpExpiresAt && grant.mcpExpiresAt.getTime() <= Date.now())
      )
        throw new ConflictException('授权已失效。');
      const letter = await manager
        .getRepository(Letter)
        .findOne({ where: { uuid: event.resourceUuid, user: { uuid: userUuid }, iSdelete: 0 } });
      if (!letter || letter.updatedAt.toISOString() !== event.details?.expectedUpdatedAt)
        throw new ConflictException('信件已改变，请重新预览后确认。');
      event.outcome = approve ? 'approved' : 'rejected';
      await repo.save(event);
    });
  }

  async requireGrant(userUuid: string, uuid: string): Promise<Auth> {
    const grant = await this.auths.findOne({
      where: { uuid, user: { uuid: userUuid }, token: Like('mcp:%'), iSdelete: 0 },
    });
    if (!grant) throw new NotFoundException('MCP 授权不存在。');
    return grant;
  }

  private toEvent(event: McpActivity) {
    return {
      uuid: event.uuid,
      authUuid: event.authUuid,
      tool: event.tool,
      resourceUuid: event.resourceUuid,
      outcome: event.outcome,
      createdAt: event.createdAt,
      expiresAt: event.expiresAt,
      details: event.details,
    };
  }
}

export const managedScopes = [...MCP_MANAGED_SCOPES];
