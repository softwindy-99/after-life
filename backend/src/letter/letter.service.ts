import { LetterDelivery } from 'src/letter-delivery/letter-delivery.entity';
import {
  assertResourceVersion,
  lockOwnedUser,
  nextUpdatedAt,
} from 'src/correspondence/transaction';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Letter } from './letter.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsWhere, In, Repository } from 'typeorm';
import { NewLetter, NewMcpLetterDraft, UpdateLetter, UpdateMcpLetterDraft } from './letter.types';
import { Contact } from 'src/contact/contact.entity';
import { User } from 'src/user/user.entity';
import { ResourceService } from 'src/resource/resource.service';
import { letterExcerpt, sanitizeLetterHtml } from './letter-content';
import { CheckIn } from 'src/check-in/check-in.entity';
import { MailService } from 'src/mail/mail.service';
import { DeliveryPreviewInput } from './letter.schema';
import { letterRetentionDays } from 'src/config/letter-retention';
import {
  assertDeliveryReview,
  createDeliveryReview,
  DeliveryReview,
  DeliveryReviewSnapshot,
} from './delivery-review';

export interface LetterPageItem {
  letter: Letter;
  contactCount: number;
}

export interface McpLetterRecord extends LetterPageItem {
  contactsTruncated: boolean;
}

@Injectable()
export class LetterService {
  constructor(
    @InjectRepository(Letter)
    private readonly letterRepository: Repository<Letter>,
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
    private readonly resourceService: ResourceService,
    private readonly mailService: MailService,
  ) {}

  async previewDelivery(userUuid: string, input: DeliveryPreviewInput): Promise<DeliveryReview> {
    return this.letterRepository.manager.transaction(async (manager) => {
      const user = await lockOwnedUser(manager.getRepository(User), userUuid);
      const lockedContacts = await this.lockOwnedContacts(
        manager.getRepository(Contact),
        userUuid,
        input.contactUuids ?? [],
        input.letterUuid,
      );
      const contacts = this.resolveOwnedContacts(lockedContacts, input.contactUuids ?? []) ?? [];
      const existing = input.letterUuid
        ? await this.lockOwnedLetter(manager.getRepository(Letter), input.letterUuid, userUuid)
        : null;
      if (input.letterUuid && !existing) throw new NotFoundException('letter not found');
      if (existing) {
        assertResourceVersion(existing.updatedAt, input.expectedUpdatedAt);
        if (
          existing.lastTriggeredAt ||
          (await manager.getRepository(LetterDelivery).count({
            where: { letter: { id: existing.id }, iSdelete: 0 },
          })) > 0
        )
          throw new ConflictException('delivery has already started; only disabling is allowed');
      }
      const content = sanitizeLetterHtml(input.content);
      const resources = await this.resourceService.validateLetterResources(
        manager,
        userUuid,
        existing?.id,
        content,
      );
      return createDeliveryReview(
        await this.reviewSnapshot(manager, user, {
          uuid: existing?.uuid,
          updatedAt: existing?.updatedAt,
          title: input.title,
          content,
          inactiveAfterMinutes: Number(input.inactiveAfterMinutes),
          contacts,
          resourceCount: resources.length,
        }),
      );
    });
  }

  async insert(newLetter: NewLetter, review?: { token?: string }): Promise<Letter> {
    return this.letterRepository.manager.transaction(async (manager) => {
      const letterRepository = manager.getRepository(Letter);
      const contactRepository = manager.getRepository(Contact);
      const user = await lockOwnedUser(manager.getRepository(User), newLetter.user.uuid);
      const contactUuids = this.uniqueContactUuids(newLetter.contacts);
      const lockedContacts =
        contactUuids === undefined
          ? []
          : await this.lockOwnedContacts(contactRepository, user.uuid, contactUuids);
      const contacts = this.resolveOwnedContacts(lockedContacts, contactUuids);
      this.assertDeliveryConfiguration(
        newLetter.deliveryEnabled ?? false,
        newLetter.inactiveAfterMinutes ?? null,
      );
      const contentFormat = newLetter.contentFormat ?? 'html';
      const content =
        contentFormat === 'html' ? sanitizeLetterHtml(newLetter.content) : newLetter.content;
      const letter = letterRepository.create({
        ...newLetter,
        content,
        user,
        excerpt: newLetter.excerpt ?? letterExcerpt(content, contentFormat),
        contentFormat,
        resourceCount: newLetter.resourceCount ?? 0,
        extra: newLetter.extra ?? null,
        deliveryEnabled: newLetter.deliveryEnabled ?? false,
        inactiveAfterMinutes: newLetter.inactiveAfterMinutes ?? null,
        contacts: contacts ?? [],
      });
      if (review && letter.deliveryEnabled) {
        const resources = await this.resourceService.validateLetterResources(
          manager,
          user.uuid,
          undefined,
          content,
        );
        assertDeliveryReview(
          review.token,
          await this.reviewSnapshot(manager, user, {
            ...letter,
            resourceCount: resources.length,
          }),
        );
      }
      const saved = await letterRepository.save(letter);
      if (contentFormat === 'html') {
        await this.resourceService.syncLetterResources(manager, user.uuid, saved, content);
        await letterRepository.save(saved);
      }
      if (contacts !== undefined) {
        await this.syncLockedContactRelations(contactRepository, saved, contacts, lockedContacts);
        return (
          (await letterRepository.findOne({
            where: { uuid: saved.uuid },
            relations: { user: true, contacts: true },
          })) ?? saved
        );
      }
      return saved;
    });
  }

  findOne(query: FindOptionsWhere<Letter>): Promise<Letter | null> {
    return this.letterRepository.findOne({
      where: query,
      relations: { user: true, contacts: true },
    });
  }

  find(query: FindOptionsWhere<Letter>): Promise<Letter[]> {
    return this.letterRepository.find({
      where: query,
      relations: { user: true, contacts: true },
      order: { createdAt: 'DESC' },
    });
  }

  findByUser(userUuid: string): Promise<Letter[]> {
    return this.find({ user: { uuid: userUuid }, iSdelete: 0 });
  }

  async findPageByUser(
    userUuid: string,
    page: number,
    pageSize: number,
  ): Promise<{ data: LetterPageItem[]; total: number }> {
    const [letters, total] = await this.letterRepository.findAndCount({
      where: { user: { uuid: userUuid }, iSdelete: 0 },
      select: {
        id: true,
        uuid: true,
        title: true,
        contentFormat: true,
        excerpt: true,
        deliveryEnabled: true,
        inactiveAfterMinutes: true,
        lastTriggeredAt: true,
        createdAt: true,
        updatedAt: true,
      },
      loadEagerRelations: false,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const counts = await this.countActiveContacts(letters, userUuid);

    return {
      data: letters.map((letter) => ({
        letter,
        contactCount: counts.get(letter.id) ?? 0,
      })),
      total,
    };
  }

  async findOwnedOneForMcp(
    letterUuid: string,
    userUuid: string,
    relationLimit: number,
  ): Promise<McpLetterRecord | null> {
    const letter = await this.letterRepository.findOne({
      where: { uuid: letterUuid, iSdelete: 0, user: { uuid: userUuid } },
      loadEagerRelations: false,
    });
    if (!letter) return null;

    const [contacts, contactCount] = await this.contactRepository.findAndCount({
      where: {
        iSdelete: 0,
        user: { uuid: userUuid },
        letters: { id: letter.id },
      },
      select: {
        id: true,
        uuid: true,
        name: true,
        email: true,
        phone: true,
        iSdelete: true,
      },
      order: { id: 'ASC' },
      take: relationLimit,
      loadEagerRelations: false,
    });
    letter.contacts = contacts;
    return {
      letter,
      contactCount,
      contactsTruncated: contactCount > contacts.length,
    };
  }

  findOwnedOne(letterUuid: string, userUuid: string): Promise<Letter | null> {
    return this.findOne({
      uuid: letterUuid,
      iSdelete: 0,
      user: { uuid: userUuid },
    });
  }

  async updateOwned(
    letterUuid: string,
    userUuid: string,
    updateLetter: UpdateLetter,
    policy?: {
      expectedUpdatedAt: string;
      allowEnabled: boolean;
      beforeWrite?: (manager: EntityManager, letter: Letter) => Promise<void>;
    },
    expectedUpdatedAt?: string,
    review?: { token?: string },
  ): Promise<Letter | null> {
    return this.letterRepository.manager.transaction(async (manager) => {
      const letterRepository = manager.getRepository(Letter);
      const contactRepository = manager.getRepository(Contact);
      const contactUuids = this.uniqueContactUuids(updateLetter.contacts);
      const mustLockContacts =
        contactUuids !== undefined ||
        updateLetter.deliveryEnabled !== undefined ||
        review !== undefined;
      const user = await lockOwnedUser(manager.getRepository(User), userUuid);
      const lockedContacts = mustLockContacts
        ? await this.lockOwnedContacts(contactRepository, userUuid, contactUuids ?? [], letterUuid)
        : [];
      const contacts = this.resolveOwnedContacts(lockedContacts, contactUuids);
      const existing = await this.lockOwnedLetter(letterRepository, letterUuid, userUuid);
      if (!existing) return null;
      assertResourceVersion(existing.updatedAt, policy?.expectedUpdatedAt ?? expectedUpdatedAt);
      if (policy) {
        if (existing.deliveryEnabled && !policy.allowEnabled)
          throw new ConflictException('editing enabled letters requires delivery permission');
        if (existing.lastTriggeredAt && updateLetter.deliveryEnabled !== false)
          throw new ConflictException('delivered letters cannot be edited');
        if (
          existing.deliveryEnabled &&
          updateLetter.inactiveAfterMinutes !== undefined &&
          !policy.beforeWrite
        )
          throw new ConflictException(
            'use the delivery preview and commit tools to change an enabled timeout',
          );
        await policy.beforeWrite?.(manager, existing);
      }

      if (
        updateLetter.deliveryEnabled !== false &&
        (await manager
          .getRepository(LetterDelivery)
          .count({ where: { letter: { id: existing.id }, iSdelete: 0 } })) > 0
      )
        throw new ConflictException('delivery has already started; only disabling is allowed');
      const payload: UpdateLetter = { ...updateLetter, contacts: undefined };
      const format = payload.contentFormat ?? existing.contentFormat;
      if (
        format === 'html' &&
        (typeof payload.content === 'string' || existing.contentFormat !== 'html')
      ) {
        payload.content = sanitizeLetterHtml(payload.content ?? existing.content);
      }
      if (typeof payload.content === 'string') {
        payload.excerpt = letterExcerpt(payload.content, format);
      }
      const next = letterRepository.merge(existing, payload);
      this.assertDeliveryConfiguration(next.deliveryEnabled, next.inactiveAfterMinutes);
      if (review && next.deliveryEnabled) {
        const resources = await this.resourceService.validateLetterResources(
          manager,
          userUuid,
          existing.id,
          next.content,
        );
        // 联系人未修改时也必须重读实际收件人；外层快照不能作为授权依据。
        // Unchanged recipients are reread as well; outer snapshots are not consent evidence.
        const recipients =
          contacts ??
          (await contactRepository.find({
            where: { letters: { id: existing.id }, user: { uuid: userUuid }, iSdelete: 0 },
            loadEagerRelations: false,
          }));
        assertDeliveryReview(
          review.token,
          await this.reviewSnapshot(manager, user, {
            ...next,
            contacts: recipients,
            resourceCount: resources.length,
          }),
        );
      }
      next.updatedAt = nextUpdatedAt(existing.updatedAt);
      const saved = await letterRepository.save(next);
      if (format === 'html') {
        await this.resourceService.syncLetterResources(manager, userUuid, saved, saved.content);
        await letterRepository.save(saved);
      }
      if (contacts !== undefined) {
        await this.syncLockedContactRelations(contactRepository, saved, contacts, lockedContacts);
      }
      return letterRepository.findOne({
        where: {
          uuid: saved.uuid,
          iSdelete: 0,
          user: { uuid: userUuid },
        },
        relations: { user: true, contacts: true },
      });
    });
  }

  async insertDraftForMcp(userUuid: string, newLetter: NewMcpLetterDraft): Promise<Letter> {
    return this.letterRepository.manager.transaction(async (manager) => {
      const letterRepository = manager.getRepository(Letter);
      const contactRepository = manager.getRepository(Contact);
      const user = await lockOwnedUser(manager.getRepository(User), userUuid);

      const lockedContacts =
        newLetter.contactUuids === undefined
          ? []
          : await this.lockOwnedContacts(contactRepository, userUuid, newLetter.contactUuids);
      const contacts = this.resolveOwnedContacts(lockedContacts, newLetter.contactUuids);
      const contentFormat = newLetter.contentFormat ?? 'markdown';
      const content =
        contentFormat === 'html' ? sanitizeLetterHtml(newLetter.content) : newLetter.content;
      const letter = letterRepository.create({
        title: newLetter.title,
        content,
        excerpt: letterExcerpt(content, contentFormat),
        contentFormat,
        resourceCount: 0,
        extra: null,
        deliveryEnabled: false,
        inactiveAfterMinutes: newLetter.inactiveAfterMinutes ?? null,
        contacts: contacts ?? [],
        user,
      });
      const saved = await letterRepository.save(letter);
      if (contentFormat === 'html') {
        await this.resourceService.syncLetterResources(manager, userUuid, saved, content);
        await letterRepository.save(saved);
      }

      if (contacts !== undefined) {
        await this.syncLockedContactRelations(contactRepository, saved, contacts, lockedContacts);
      }

      return (
        (await letterRepository.findOne({
          where: {
            uuid: saved.uuid,
            iSdelete: 0,
            user: { uuid: userUuid },
          },
          loadEagerRelations: false,
        })) ?? saved
      );
    });
  }

  async updateOwnedDraftForMcp(
    letterUuid: string,
    userUuid: string,
    expectedUpdatedAt: string,
    updateLetter: UpdateMcpLetterDraft,
  ): Promise<Letter | null> {
    return this.letterRepository.manager.transaction(async (manager) => {
      const letterRepository = manager.getRepository(Letter);
      const contactRepository = manager.getRepository(Contact);
      await lockOwnedUser(manager.getRepository(User), userUuid);
      const lockedContacts =
        updateLetter.contactUuids === undefined
          ? []
          : await this.lockOwnedContacts(
              contactRepository,
              userUuid,
              updateLetter.contactUuids,
              letterUuid,
            );
      const contacts = this.resolveOwnedContacts(lockedContacts, updateLetter.contactUuids);
      const existing = await this.lockOwnedLetter(letterRepository, letterUuid, userUuid);

      if (!existing) return null;
      assertResourceVersion(existing.updatedAt, expectedUpdatedAt);
      if (existing.deliveryEnabled) {
        throw new ConflictException('delivery-enabled letters cannot be changed through MCP');
      }
      if (
        (await manager
          .getRepository(LetterDelivery)
          .count({ where: { letter: { id: existing.id }, iSdelete: 0 } })) > 0
      )
        throw new ConflictException('delivery has already started');

      const payload: UpdateLetter = {};
      if (updateLetter.title !== undefined) payload.title = updateLetter.title;
      if (updateLetter.content !== undefined) payload.content = updateLetter.content;
      if (updateLetter.contentFormat !== undefined) {
        payload.contentFormat = updateLetter.contentFormat;
      }
      if (updateLetter.inactiveAfterMinutes !== undefined) {
        payload.inactiveAfterMinutes = updateLetter.inactiveAfterMinutes;
      }
      const format = payload.contentFormat ?? existing.contentFormat;
      if (
        format === 'html' &&
        (typeof payload.content === 'string' || existing.contentFormat !== 'html')
      ) {
        payload.content = sanitizeLetterHtml(payload.content ?? existing.content);
      }
      if (typeof payload.content === 'string') {
        payload.excerpt = letterExcerpt(payload.content, format);
      }

      const next = letterRepository.merge(existing, payload);
      next.updatedAt = nextUpdatedAt(existing.updatedAt);
      const saved = await letterRepository.save(next);
      if (format === 'html') {
        await this.resourceService.syncLetterResources(manager, userUuid, saved, saved.content);
        await letterRepository.save(saved);
      }
      if (contacts !== undefined) {
        await this.syncLockedContactRelations(contactRepository, saved, contacts, lockedContacts);
      }

      return letterRepository.findOne({
        where: {
          uuid: saved.uuid,
          iSdelete: 0,
          user: { uuid: userUuid },
        },
        loadEagerRelations: false,
      });
    });
  }

  async removeOwned(letterUuid: string, userUuid: string): Promise<void> {
    await this.letterRepository.manager.transaction(async (manager) => {
      const letterRepository = manager.getRepository(Letter);
      const contactRepository = manager.getRepository(Contact);
      await lockOwnedUser(manager.getRepository(User), userUuid);
      const lockedContacts = await this.lockOwnedContacts(
        contactRepository,
        userUuid,
        [],
        letterUuid,
      );
      const existing = await this.lockOwnedLetter(letterRepository, letterUuid, userUuid);
      if (!existing) return;

      existing.iSdelete = 1;
      existing.updatedAt = nextUpdatedAt(existing.updatedAt);
      await letterRepository.save(existing);

      for (const contact of lockedContacts) {
        if (
          contact.iSdelete === 1 ||
          !(contact.letters ?? []).some((letter) => letter.uuid === letterUuid)
        ) {
          continue;
        }
        contact.updatedAt = nextUpdatedAt(contact.updatedAt);
        await contactRepository.save(contact);
      }
    });
  }

  private async countActiveContacts(
    letters: Letter[],
    userUuid: string,
  ): Promise<Map<number, number>> {
    if (letters.length === 0) return new Map();

    const rows = await this.contactRepository
      .createQueryBuilder('contact')
      .innerJoin('contact.letters', 'letter')
      .innerJoin('contact.user', 'user')
      .select('letter.id', 'letterId')
      .addSelect('COUNT(DISTINCT contact.id)', 'relationCount')
      .where('letter.id IN (:...letterIds)', {
        letterIds: letters.map((letter) => letter.id),
      })
      .andWhere('contact.iSdelete = :active', { active: 0 })
      .andWhere('user.uuid = :userUuid', { userUuid })
      .groupBy('letter.id')
      .getRawMany<{ letterId: string; relationCount: string }>();

    return new Map(rows.map((row) => [Number(row.letterId), Number(row.relationCount)]));
  }

  private uniqueContactUuids(contacts?: Pick<Contact, 'uuid'>[]): string[] | undefined {
    return contacts === undefined
      ? undefined
      : [...new Set(contacts.map((contact) => contact.uuid))];
  }

  private async lockOwnedContacts(
    contactRepository: Repository<Contact>,
    userUuid: string,
    contactUuids: string[],
    letterUuid?: string,
  ): Promise<Contact[]> {
    const where: FindOptionsWhere<Contact>[] = [];
    if (contactUuids.length > 0) {
      where.push({ user: { uuid: userUuid }, uuid: In(contactUuids) });
    }
    if (letterUuid) {
      where.push({ user: { uuid: userUuid }, letters: { uuid: letterUuid } });
    }
    if (where.length === 0) return [];

    const candidates = await contactRepository.find({
      where,
      select: { id: true, uuid: true },
      order: { id: 'ASC' },
      loadEagerRelations: false,
    });
    const lockedContacts: Contact[] = [];

    for (const candidate of candidates) {
      const locked = await contactRepository.findOne({
        where: { id: candidate.id },
        select: { id: true, uuid: true, name: true, email: true, iSdelete: true, updatedAt: true },
        loadEagerRelations: false,
        lock: { mode: 'pessimistic_write' },
      });
      if (locked) lockedContacts.push(locked);
    }

    for (const contact of lockedContacts) {
      const withRelations = await contactRepository.findOne({
        where: { id: contact.id },
        select: {
          id: true,
          uuid: true,
          iSdelete: true,
          letters: { id: true, uuid: true, iSdelete: true },
        },
        relations: { letters: true },
        loadEagerRelations: false,
      });
      contact.letters = withRelations?.letters ?? [];
    }

    return lockedContacts;
  }

  private resolveOwnedContacts(
    lockedContacts: Contact[],
    contactUuids?: string[],
  ): Contact[] | undefined {
    if (contactUuids === undefined) return undefined;

    const activeByUuid = new Map(
      lockedContacts
        .filter((contact) => contact.iSdelete !== 1)
        .map((contact) => [contact.uuid, contact]),
    );
    const contacts = contactUuids.map((uuid) => activeByUuid.get(uuid));
    if (contacts.some((contact) => !contact)) {
      throw new NotFoundException('contact not found');
    }

    return contacts as Contact[];
  }

  private async syncLockedContactRelations(
    contactRepository: Repository<Contact>,
    letter: Letter,
    contacts: Contact[],
    lockedContacts: Contact[],
  ): Promise<void> {
    const desiredContactUuids = new Set(contacts.map((contact) => contact.uuid));

    for (const contact of lockedContacts) {
      const letters = contact.letters ?? [];
      const hasLetter = letters.some((item) => item.uuid === letter.uuid);
      const shouldHaveLetter = contact.iSdelete !== 1 && desiredContactUuids.has(contact.uuid);

      if (shouldHaveLetter && !hasLetter) {
        contact.letters = [...letters, letter];
        contact.updatedAt = nextUpdatedAt(contact.updatedAt);
        await contactRepository.save(contact);
      }

      if (!shouldHaveLetter && hasLetter) {
        contact.letters = letters.filter((item) => item.uuid !== letter.uuid);
        contact.updatedAt = nextUpdatedAt(contact.updatedAt);
        await contactRepository.save(contact);
      }
    }
  }

  private async lockOwnedLetter(
    letterRepository: Repository<Letter>,
    letterUuid: string,
    userUuid: string,
  ): Promise<Letter | null> {
    const candidate = await letterRepository.findOne({
      where: {
        uuid: letterUuid,
        iSdelete: 0,
        user: { uuid: userUuid },
      },
      select: { id: true, uuid: true },
      loadEagerRelations: false,
    });
    if (!candidate) return null;

    return letterRepository.findOne({
      where: { id: candidate.id, iSdelete: 0 },
      loadEagerRelations: false,
      lock: { mode: 'pessimistic_write' },
    });
  }

  private assertDeliveryConfiguration(
    deliveryEnabled: boolean,
    inactiveAfterMinutes?: number | null,
  ): void {
    if (deliveryEnabled && !inactiveAfterMinutes) {
      throw new BadRequestException(
        'inactiveAfterMinutes is required when deliveryEnabled is true',
      );
    }
  }

  private async reviewSnapshot(
    manager: EntityManager,
    user: User,
    letter: {
      uuid?: string;
      updatedAt?: Date;
      title: string;
      content: string;
      inactiveAfterMinutes?: number | null;
      contacts: Contact[];
      resourceCount: number;
    },
  ): Promise<DeliveryReviewSnapshot> {
    this.assertDeliveryConfiguration(true, letter.inactiveAfterMinutes);
    const latest = await manager.getRepository(CheckIn).findOne({
      where: { user: { uuid: user.uuid }, iSdelete: 0 },
      order: { checkedAt: 'DESC' },
    });
    return {
      userUuid: user.uuid,
      letterUuid: letter.uuid ?? null,
      updatedAt: letter.updatedAt?.toISOString() ?? null,
      title: letter.title,
      content: letter.content,
      inactiveAfterMinutes: Number(letter.inactiveAfterMinutes),
      baselineAt: (latest?.checkedAt ?? user.createdAt).toISOString(),
      baselineSource: latest ? 'check-in' : 'account-created',
      contacts: letter.contacts
        .map((contact) => ({
          uuid: contact.uuid,
          name: contact.name,
          email: contact.email || null,
        }))
        .sort((left, right) => left.uuid.localeCompare(right.uuid)),
      resourceCount: letter.resourceCount,
      retentionDays: letterRetentionDays(),
      mailConfigured: this.mailService.isConfigured(),
      publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
    };
  }
}
