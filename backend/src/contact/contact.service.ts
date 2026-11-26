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
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { Letter } from 'src/letter/letter.entity';
import { User } from 'src/user/user.entity';
import { Contact } from './contact.entity';
import { NewContact, UpdateContact } from './contact.types';

export interface ContactPageItem {
  contact: Contact;
  linkedLetterCount: number;
}

export interface McpContactRecord extends ContactPageItem {
  letterUuidsTruncated: boolean;
}

@Injectable()
export class ContactService {
  constructor(
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
    @InjectRepository(Letter)
    private readonly letterRepository: Repository<Letter>,
  ) {}

  private buildDisplaySummary(contact: { email?: string | null; phone?: string | null }): string {
    return [contact.email, contact.phone].filter(Boolean).join(' | ');
  }

  async insert(newContact: NewContact): Promise<Contact> {
    return this.contactRepository.manager.transaction(async (manager) => {
      const contactRepository = manager.getRepository(Contact);
      const user = await lockOwnedUser(manager.getRepository(User), newContact.user.uuid);
      const letterUuids = this.uniqueLetterUuids(newContact.letters);
      const lockedLetters =
        letterUuids === undefined
          ? []
          : await this.lockOwnedLetters(manager.getRepository(Letter), user.uuid, letterUuids);
      const letters = this.resolveOwnedLetters(lockedLetters, letterUuids);
      const contact = contactRepository.create({
        ...newContact,
        user,
        letters: letters ?? [],
        extra: newContact.extra ?? null,
        displaySummary: this.buildDisplaySummary(newContact),
      });
      const saved = await contactRepository.save(contact);
      await this.bumpChangedLetterTimestamps(
        manager.getRepository(Letter),
        lockedLetters,
        new Set(letterUuids ?? []),
      );
      return saved;
    });
  }

  findOne(query: FindOptionsWhere<Contact>): Promise<Contact | null> {
    return this.contactRepository.findOne({
      where: query,
      relations: { user: true, letters: true },
    });
  }

  find(query: FindOptionsWhere<Contact>): Promise<Contact[]> {
    return this.contactRepository.find({
      where: query,
      relations: { user: true, letters: true },
      order: { createdAt: 'DESC' },
    });
  }

  findByUser(userUuid: string): Promise<Contact[]> {
    return this.find({ user: { uuid: userUuid }, iSdelete: 0 });
  }

  async findPageByUser(
    userUuid: string,
    page: number,
    pageSize: number,
  ): Promise<{ data: ContactPageItem[]; total: number }> {
    const [contacts, total] = await this.contactRepository.findAndCount({
      where: { user: { uuid: userUuid }, iSdelete: 0 },
      select: {
        id: true,
        uuid: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
      },
      loadEagerRelations: false,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const counts = await this.countActiveLetters(contacts, userUuid);

    return {
      data: contacts.map((contact) => ({
        contact,
        linkedLetterCount: counts.get(contact.id) ?? 0,
      })),
      total,
    };
  }

  async findOwnedOneForMcp(
    contactUuid: string,
    userUuid: string,
    relationLimit: number,
  ): Promise<McpContactRecord | null> {
    const contact = await this.contactRepository.findOne({
      where: { uuid: contactUuid, iSdelete: 0, user: { uuid: userUuid } },
      loadEagerRelations: false,
    });
    if (!contact) return null;

    const [letters, linkedLetterCount] = await this.letterRepository.findAndCount({
      where: {
        iSdelete: 0,
        user: { uuid: userUuid },
        contacts: { id: contact.id },
      },
      select: { id: true, uuid: true, iSdelete: true },
      order: { id: 'ASC' },
      take: relationLimit,
      loadEagerRelations: false,
    });
    contact.letters = letters;
    return {
      contact,
      linkedLetterCount,
      letterUuidsTruncated: linkedLetterCount > letters.length,
    };
  }

  findOwnedOne(contactUuid: string, userUuid: string): Promise<Contact | null> {
    return this.findOne({
      uuid: contactUuid,
      iSdelete: 0,
      user: { uuid: userUuid },
    });
  }

  async updateOwned(
    contactUuid: string,
    userUuid: string,
    updateContact: UpdateContact,
    expectedUpdatedAt?: string,
  ): Promise<Contact | null> {
    return this.contactRepository.manager.transaction(async (manager) => {
      const contactRepository = manager.getRepository(Contact);
      const letterRepository = manager.getRepository(Letter);
      const updatesRelations = updateContact.letters !== undefined;
      const changesDeliveryAddress =
        updateContact.email !== undefined || updateContact.phone !== undefined;
      await lockOwnedUser(manager.getRepository(User), userUuid);

      const existing = await this.lockOwnedContact(contactRepository, contactUuid, userUuid);
      if (!existing) return null;
      assertResourceVersion(existing.updatedAt, expectedUpdatedAt);

      let currentLetters: Letter[] = [];
      let letters: Letter[] | undefined;
      let lockedLetters: Letter[] = [];
      if (updatesRelations) {
        const withLetters = await contactRepository.findOne({
          where: { id: existing.id, user: { uuid: userUuid } },
          select: {
            id: true,
            uuid: true,
            letters: { id: true, uuid: true, iSdelete: true },
          },
          relations: { letters: true },
          loadEagerRelations: false,
        });
        currentLetters = withLetters?.letters ?? [];
        const desiredLetterUuids = this.uniqueLetterUuids(updateContact.letters);
        const candidateLetterUuids = [
          ...new Set([
            ...currentLetters.map((letter) => letter.uuid),
            ...(desiredLetterUuids ?? []),
          ]),
        ];
        lockedLetters = await this.lockOwnedLetters(
          letterRepository,
          userUuid,
          candidateLetterUuids,
        );
        letters = this.resolveOwnedLetters(lockedLetters, desiredLetterUuids);

        if (
          changesDeliveryAddress &&
          lockedLetters.some((letter) => letter.iSdelete !== 1 && letter.deliveryEnabled)
        ) {
          throw new ConflictException(
            'contact email and phone cannot be changed while linked delivery is enabled',
          );
        }
      } else if (
        changesDeliveryAddress &&
        (await this.findEnabledLinkedLetter(letterRepository, userUuid, existing.id))
      ) {
        throw new ConflictException(
          'contact email and phone cannot be changed while linked delivery is enabled',
        );
      }

      const mergedAddress = {
        email: updateContact.email === undefined ? existing.email : updateContact.email,
        phone: updateContact.phone === undefined ? existing.phone : updateContact.phone,
      };
      if (!mergedAddress.email && !mergedAddress.phone) {
        throw new BadRequestException('at least one contact method is required: email or phone');
      }
      if (!updatesRelations) {
        const linked = await letterRepository.find({
          where: { contacts: { id: existing.id }, user: { uuid: userUuid }, iSdelete: 0 },
          select: { id: true, uuid: true },
          order: { id: 'ASC' },
        });
        lockedLetters = await this.lockOwnedLetters(
          letterRepository,
          userUuid,
          linked.map((letter) => letter.uuid),
        );
      }
      const payload: UpdateContact = { ...updateContact, letters: undefined };
      const next = contactRepository.merge(existing, {
        ...payload,
        displaySummary: this.buildDisplaySummary(mergedAddress),
      });
      next.updatedAt = nextUpdatedAt(existing.updatedAt);
      const changedLetterUuids =
        letters === undefined
          ? new Set(lockedLetters.map((letter) => letter.uuid))
          : new Set([
              ...this.changedRelationUuids(currentLetters, letters),
              ...lockedLetters.map((letter) => letter.uuid),
            ]);
      if (letters !== undefined) {
        next.letters = letters;
      }

      const saved = await contactRepository.save(next);
      await this.bumpChangedLetterTimestamps(letterRepository, lockedLetters, changedLetterUuids);
      return contactRepository.findOne({
        where: {
          uuid: saved.uuid,
          iSdelete: 0,
          user: { uuid: userUuid },
        },
        loadEagerRelations: false,
      });
    });
  }

  async updateOwnedForMcp(
    contactUuid: string,
    userUuid: string,
    expectedUpdatedAt: string,
    updateContact: UpdateContact,
    allowEnabledDeliveryChanges = false,
  ): Promise<Contact | null> {
    return this.contactRepository.manager.transaction(async (manager) => {
      const contactRepository = manager.getRepository(Contact);
      const letterRepository = manager.getRepository(Letter);
      const changesDeliveryAddress =
        updateContact.email !== undefined || updateContact.phone !== undefined;
      await lockOwnedUser(manager.getRepository(User), userUuid);
      const existing = await this.lockOwnedContact(contactRepository, contactUuid, userUuid);

      if (!existing) return null;
      assertResourceVersion(existing.updatedAt, expectedUpdatedAt);

      if (changesDeliveryAddress && !allowEnabledDeliveryChanges) {
        const enabledLetter = await this.findEnabledLinkedLetter(
          letterRepository,
          userUuid,
          existing.id,
        );
        if (enabledLetter) {
          throw new ConflictException(
            'contact email and phone cannot be changed while linked delivery is enabled',
          );
        }
      }

      const mergedAddress = {
        email: updateContact.email === undefined ? existing.email : updateContact.email,
        phone: updateContact.phone === undefined ? existing.phone : updateContact.phone,
      };
      if (!mergedAddress.email && !mergedAddress.phone) {
        throw new BadRequestException('at least one contact method is required: email or phone');
      }

      let affectedLetters: Letter[] = [];
      {
        const linked = await letterRepository.find({
          where: { contacts: { id: existing.id }, user: { uuid: userUuid }, iSdelete: 0 },
          select: { id: true, uuid: true },
          order: { id: 'ASC' },
        });
        affectedLetters = await this.lockOwnedLetters(
          letterRepository,
          userUuid,
          linked.map((letter) => letter.uuid),
        );
      }
      const next = contactRepository.merge(existing, {
        ...updateContact,
        displaySummary: this.buildDisplaySummary(mergedAddress),
      });
      next.updatedAt = nextUpdatedAt(existing.updatedAt);
      const saved = await contactRepository.save(next);
      await this.bumpChangedLetterTimestamps(
        letterRepository,
        affectedLetters,
        new Set(affectedLetters.map((letter) => letter.uuid)),
      );

      return contactRepository.findOne({
        where: {
          uuid: saved.uuid,
          iSdelete: 0,
          user: { uuid: userUuid },
        },
        loadEagerRelations: false,
      });
    });
  }

  async removeOwned(contactUuid: string, userUuid: string): Promise<void> {
    await this.contactRepository.manager.transaction(async (manager) => {
      const contactRepository = manager.getRepository(Contact);
      const letterRepository = manager.getRepository(Letter);
      await lockOwnedUser(manager.getRepository(User), userUuid);
      const existing = await this.lockOwnedContact(contactRepository, contactUuid, userUuid);
      if (!existing) return;

      const withLetters = await contactRepository.findOne({
        where: { id: existing.id },
        select: {
          id: true,
          uuid: true,
          letters: { id: true, uuid: true, iSdelete: true },
        },
        relations: { letters: true },
        loadEagerRelations: false,
      });
      const currentLetterUuids = (withLetters?.letters ?? []).map((letter) => letter.uuid);
      const lockedLetters = await this.lockOwnedLetters(
        letterRepository,
        userUuid,
        currentLetterUuids,
      );

      existing.iSdelete = 1;
      existing.updatedAt = nextUpdatedAt(existing.updatedAt);
      await contactRepository.save(existing);
      await this.bumpChangedLetterTimestamps(
        letterRepository,
        lockedLetters,
        new Set(
          lockedLetters.filter((letter) => letter.iSdelete !== 1).map((letter) => letter.uuid),
        ),
      );
    });
  }

  private async countActiveLetters(
    contacts: Contact[],
    userUuid: string,
  ): Promise<Map<number, number>> {
    if (contacts.length === 0) return new Map();

    const rows = await this.letterRepository
      .createQueryBuilder('letter')
      .innerJoin('letter.contacts', 'contact')
      .innerJoin('letter.user', 'user')
      .select('contact.id', 'contactId')
      .addSelect('COUNT(DISTINCT letter.id)', 'relationCount')
      .where('contact.id IN (:...contactIds)', {
        contactIds: contacts.map((contact) => contact.id),
      })
      .andWhere('letter.iSdelete = :active', { active: 0 })
      .andWhere('user.uuid = :userUuid', { userUuid })
      .groupBy('contact.id')
      .getRawMany<{ contactId: string; relationCount: string }>();

    return new Map(rows.map((row) => [Number(row.contactId), Number(row.relationCount)]));
  }

  private uniqueLetterUuids(letters?: Letter[]): string[] | undefined {
    return letters === undefined ? undefined : [...new Set(letters.map((letter) => letter.uuid))];
  }

  private async lockOwnedLetters(
    letterRepository: Repository<Letter>,
    userUuid: string,
    letterUuids: string[],
  ): Promise<Letter[]> {
    if (letterUuids.length === 0) return [];

    const candidates = await letterRepository.find({
      where: { uuid: In(letterUuids), user: { uuid: userUuid } },
      select: { id: true, uuid: true },
      order: { id: 'ASC' },
      loadEagerRelations: false,
    });
    const lockedLetters: Letter[] = [];
    for (const candidate of candidates) {
      const locked = await letterRepository.findOne({
        where: { id: candidate.id },
        select: {
          id: true,
          uuid: true,
          iSdelete: true,
          updatedAt: true,
          deliveryEnabled: true,
        },
        loadEagerRelations: false,
        lock: { mode: 'pessimistic_write' },
      });
      if (locked) lockedLetters.push(locked);
    }
    return lockedLetters;
  }

  private resolveOwnedLetters(
    lockedLetters: Letter[],
    letterUuids?: string[],
  ): Letter[] | undefined {
    if (letterUuids === undefined) return undefined;

    const activeByUuid = new Map(
      lockedLetters
        .filter((letter) => letter.iSdelete !== 1)
        .map((letter) => [letter.uuid, letter]),
    );
    const letters = letterUuids.map((uuid) => activeByUuid.get(uuid));
    if (letters.some((letter) => !letter)) {
      throw new NotFoundException('letter not found');
    }
    return letters as Letter[];
  }

  private changedRelationUuids(current: Letter[], desired: Letter[]): Set<string> {
    const currentUuids = new Set(current.map((letter) => letter.uuid));
    const desiredUuids = new Set(desired.map((letter) => letter.uuid));
    return new Set([
      ...[...currentUuids].filter((uuid) => !desiredUuids.has(uuid)),
      ...[...desiredUuids].filter((uuid) => !currentUuids.has(uuid)),
    ]);
  }

  private async bumpChangedLetterTimestamps(
    letterRepository: Repository<Letter>,
    lockedLetters: Letter[],
    changedLetterUuids: Set<string>,
  ): Promise<void> {
    for (const letter of lockedLetters) {
      if (!changedLetterUuids.has(letter.uuid)) continue;
      letter.updatedAt = nextUpdatedAt(letter.updatedAt);
      await letterRepository.save(letter);
    }
  }

  private async lockOwnedContact(
    contactRepository: Repository<Contact>,
    contactUuid: string,
    userUuid: string,
  ): Promise<Contact | null> {
    const candidate = await contactRepository.findOne({
      where: {
        uuid: contactUuid,
        iSdelete: 0,
        user: { uuid: userUuid },
      },
      select: { id: true, uuid: true },
      loadEagerRelations: false,
    });
    if (!candidate) return null;

    return contactRepository.findOne({
      where: { id: candidate.id, iSdelete: 0 },
      loadEagerRelations: false,
      lock: { mode: 'pessimistic_write' },
    });
  }

  private findEnabledLinkedLetter(
    letterRepository: Repository<Letter>,
    userUuid: string,
    contactId: number,
  ): Promise<Letter | null> {
    return letterRepository.findOne({
      where: {
        iSdelete: 0,
        deliveryEnabled: true,
        user: { uuid: userUuid },
        contacts: { id: contactId },
      },
      select: { id: true, uuid: true },
      loadEagerRelations: false,
    });
  }
}
