import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Letter } from './letter.entity';
import { LetterService } from './letter.service';
import { createMockRepository } from 'src/test-utils/mock-repository';
import { Contact } from 'src/contact/contact.entity';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { User } from 'src/user/user.entity';
import { ResourceService } from 'src/resource/resource.service';
import { MailService } from 'src/mail/mail.service';
import { CheckIn } from 'src/check-in/check-in.entity';
import { LetterDelivery } from 'src/letter-delivery/letter-delivery.entity';

function createCountQueryBuilder(rows: Array<Record<string, string>>) {
  const builder: Record<string, jest.Mock> = {};
  for (const method of ['innerJoin', 'select', 'addSelect', 'where', 'andWhere', 'groupBy']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.getRawMany = jest.fn().mockResolvedValue(rows);
  return builder;
}

describe('LetterService', () => {
  let service: LetterService;
  let repository: ReturnType<typeof createMockRepository>;
  let contactRepository: ReturnType<typeof createMockRepository>;
  let userRepository: ReturnType<typeof createMockRepository>;
  let checkInRepository: ReturnType<typeof createMockRepository>;
  let deliveryRepository: ReturnType<typeof createMockRepository>;
  let resourceService: { syncLetterResources: jest.Mock; validateLetterResources: jest.Mock };

  beforeEach(async () => {
    repository = createMockRepository();
    contactRepository = createMockRepository();
    userRepository = createMockRepository();
    checkInRepository = createMockRepository();
    deliveryRepository = createMockRepository();
    resourceService = {
      syncLetterResources: jest.fn(),
      validateLetterResources: jest.fn().mockResolvedValue([]),
    };
    userRepository.findOne.mockResolvedValue({ id: 9, uuid: 'user-1' });
    Object.assign(repository, {
      manager: {
        transaction: jest.fn(
          async (
            work: (manager: {
              getRepository: (entity: unknown) => typeof repository;
            }) => Promise<unknown>,
          ) =>
            work({
              getRepository: (entity) => {
                if (entity === Letter) return repository;
                if (entity === User) return userRepository;
                if (entity === CheckIn) return checkInRepository;
                if (entity === LetterDelivery) return deliveryRepository;
                return contactRepository;
              },
            }),
        ),
      },
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        LetterService,
        { provide: getRepositoryToken(Letter), useValue: repository },
        { provide: getRepositoryToken(Contact), useValue: contactRepository },
        { provide: ResourceService, useValue: resourceService },
        { provide: MailService, useValue: { isConfigured: () => true } },
      ],
    }).compile();

    service = moduleRef.get(LetterService);
  });

  it('creates a letter with default derived fields', async () => {
    const input = {
      title: 'Hello',
      content: 'hello   world',
      user: { id: 9, uuid: 'user-1' },
    };
    const created = {
      ...input,
      excerpt: 'hello world',
      contentFormat: 'html',
      resourceCount: 0,
      extra: null as unknown,
      deliveryEnabled: false,
      inactiveAfterMinutes: null as number | null,
      contacts: [] as unknown[],
    };

    repository.create.mockReturnValue(created);
    repository.save.mockResolvedValue({ ...created, uuid: 'letter-1' });

    await expect(service.insert(input as any)).resolves.toEqual({
      ...created,
      uuid: 'letter-1',
    });

    expect(repository.create).toHaveBeenCalledWith(created);
  });

  it('finds letters by user', async () => {
    repository.find.mockResolvedValue([{ uuid: 'letter-1' }]);

    await expect(service.findByUser('user-1')).resolves.toEqual([{ uuid: 'letter-1' }]);

    expect(repository.find).toHaveBeenCalledWith({
      where: { user: { uuid: 'user-1' }, iSdelete: 0 },
      relations: { user: true, contacts: true },
      order: { createdAt: 'DESC' },
    });
  });

  it('returns a projected, bounded page without letter bodies', async () => {
    const letter = { id: 2, uuid: 'letter-1' };
    const queryBuilder = createCountQueryBuilder([{ letterId: '2', relationCount: '3' }]);
    repository.findAndCount.mockResolvedValue([[letter], 1]);
    contactRepository.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(service.findPageByUser('user-1', 2, 20)).resolves.toEqual({
      data: [{ letter, contactCount: 3 }],
      total: 1,
    });

    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user: { uuid: 'user-1' }, iSdelete: 0 },
        skip: 20,
        take: 20,
        loadEagerRelations: false,
        order: { createdAt: 'DESC', id: 'DESC' },
      }),
    );
    expect(repository.findAndCount.mock.calls[0][0].select).not.toHaveProperty('content');
    expect(repository.findAndCount.mock.calls[0][0]).not.toHaveProperty('relations');
    expect(queryBuilder.getRawMany).toHaveBeenCalledTimes(1);
  });

  it('bounds MCP letter contacts while preserving the total count', async () => {
    const letter = { id: 2, uuid: 'letter-1' };
    const contacts = [
      { id: 1, uuid: 'contact-1', iSdelete: 0 },
      { id: 3, uuid: 'contact-2', iSdelete: 0 },
    ];
    repository.findOne.mockResolvedValue(letter);
    contactRepository.findAndCount.mockResolvedValue([contacts, 3]);

    await expect(service.findOwnedOneForMcp('letter-1', 'user-1', 2)).resolves.toEqual({
      letter: { ...letter, contacts },
      contactCount: 3,
      contactsTruncated: true,
    });
    expect(contactRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2, loadEagerRelations: false }),
    );
  });

  it('updates the excerpt when content changes', async () => {
    const updatedAt = new Date('2026-07-17T01:02:03.000Z');
    const existing = {
      id: 2,
      uuid: 'letter-1',
      content: 'old text',
      deliveryEnabled: false,
      inactiveAfterMinutes: null as number | null,
      updatedAt,
    };
    const merged = {
      ...existing,
      content: ' updated   text ',
      excerpt: 'updated text',
    };
    repository.findOne
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ uuid: 'letter-1', excerpt: 'updated text' });
    repository.merge.mockReturnValue(merged);
    repository.save.mockResolvedValue(merged);
    const now = jest.spyOn(Date, 'now').mockReturnValue(updatedAt.getTime());

    await expect(
      service.updateOwned('letter-1', 'user-1', {
        content: ' updated   text ',
      }),
    ).resolves.toEqual({ uuid: 'letter-1', excerpt: 'updated text' });
    now.mockRestore();

    expect(repository.merge).toHaveBeenCalledWith(existing, {
      content: ' updated   text ',
      excerpt: 'updated text',
    });
    expect(repository.save).toHaveBeenCalledWith(merged);
    expect(merged.updatedAt.getTime()).toBe(updatedAt.getTime() + 1);
  });

  it('rechecks the enabled-delivery threshold while holding the letter lock', async () => {
    const existing = {
      id: 2,
      uuid: 'letter-1',
      iSdelete: 0,
      updatedAt: new Date('2026-07-17T01:02:03.000Z'),
      deliveryEnabled: false,
      inactiveAfterMinutes: null as number | null,
    };
    const invalid = { ...existing, deliveryEnabled: true };
    contactRepository.find.mockResolvedValue([]);
    repository.findOne.mockResolvedValueOnce({ id: 2 }).mockResolvedValueOnce(existing);
    repository.merge.mockReturnValue(invalid);

    await expect(
      service.updateOwned('letter-1', 'user-1', { deliveryEnabled: true }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.save).not.toHaveBeenCalled();
  });

  it('locks REST delivery contacts before enabling their letter', async () => {
    const updatedAt = new Date('2026-07-17T01:02:03.000Z');
    const linkedLetter = {
      id: 2,
      uuid: 'letter-1',
      iSdelete: 0,
      deliveryEnabled: false,
      inactiveAfterMinutes: 1440,
      updatedAt,
    };
    const contact = {
      id: 1,
      uuid: 'contact-1',
      iSdelete: 0,
      updatedAt: new Date('2026-07-17T01:02:03.000Z'),
      letters: [linkedLetter],
    };
    const enabled = { ...linkedLetter, deliveryEnabled: true };
    contactRepository.find.mockResolvedValue([{ id: 1 }]);
    contactRepository.findOne.mockResolvedValue(contact);
    repository.findOne
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce(linkedLetter)
      .mockResolvedValueOnce(enabled);
    repository.merge.mockReturnValue(enabled);
    repository.save.mockResolvedValue(enabled);

    await service.updateOwned('letter-1', 'user-1', {
      deliveryEnabled: true,
      contacts: [contact] as any,
    });

    expect(contactRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(userRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(userRepository.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      contactRepository.findOne.mock.invocationCallOrder[0],
    );
    expect(contactRepository.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      repository.findOne.mock.invocationCallOrder[0],
    );
  });

  it('syncs contact relations from the owning contact side', async () => {
    const contactUpdatedAt = new Date('2026-07-17T01:02:03.000Z');
    const letter = {
      uuid: 'letter-1',
      title: 'Hello',
      content: 'World',
      user: { uuid: 'user-1' },
      contacts: [{ uuid: 'contact-1' }],
    };
    const ownedContact = {
      id: 1,
      uuid: 'contact-1',
      iSdelete: 0,
      updatedAt: contactUpdatedAt,
      letters: [] as unknown[],
    };
    repository.create.mockReturnValue(letter);
    repository.save.mockResolvedValue(letter);
    repository.findOne.mockResolvedValue(letter);
    contactRepository.find.mockResolvedValue([{ id: 1 }]);
    contactRepository.findOne.mockResolvedValue(ownedContact);
    contactRepository.save.mockResolvedValue(ownedContact);

    await service.insert(letter as any);

    expect(contactRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        uuid: 'contact-1',
        letters: [letter],
        updatedAt: expect.any(Date),
      }),
    );
    expect(contactRepository.save.mock.calls[0][0].updatedAt.getTime()).toBeGreaterThan(
      contactUpdatedAt.getTime(),
    );
  });

  it('creates an MCP draft and contact relations in one transaction', async () => {
    const transactionLetterRepository = createMockRepository();
    const transactionContactRepository = createMockRepository();
    const transactionUserRepository = createMockRepository();
    const getRepository = jest.fn((entity: unknown) => {
      if (entity === Letter) return transactionLetterRepository;
      if (entity === User) return transactionUserRepository;
      return transactionContactRepository;
    });
    const transaction = jest.fn(
      async (work: (manager: { getRepository: typeof getRepository }) => Promise<unknown>) =>
        work({ getRepository }),
    );
    Object.assign(repository, { manager: { transaction } });
    const contact = {
      id: 1,
      uuid: 'contact-1',
      iSdelete: 0,
      updatedAt: new Date('2026-07-17T01:02:03.000Z'),
      letters: [] as Letter[],
      user: { uuid: 'user-1' },
    };
    const user = { id: 9, uuid: 'user-1' };
    const created = {
      title: 'Hello',
      content: 'Draft body',
      excerpt: 'Draft body',
      contentFormat: 'markdown',
      resourceCount: 0,
      extra: null as Record<string, unknown> | null,
      deliveryEnabled: false,
      inactiveAfterMinutes: null as number | null,
      contacts: [contact],
      user,
    };
    const saved = { ...created, uuid: 'letter-1' };
    const result = { ...saved, contacts: [contact] };
    transactionUserRepository.findOne.mockResolvedValue(user);
    transactionContactRepository.find.mockResolvedValue([{ id: 1 }]);
    transactionContactRepository.findOne.mockResolvedValue(contact);
    transactionLetterRepository.create.mockReturnValue(created);
    transactionLetterRepository.save.mockResolvedValue(saved);
    transactionLetterRepository.findOne.mockResolvedValue(result);
    transactionContactRepository.save.mockResolvedValue(contact);

    await expect(
      service.insertDraftForMcp('user-1', {
        title: 'Hello',
        content: 'Draft body',
        contactUuids: ['contact-1'],
      }),
    ).resolves.toEqual(result);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transactionLetterRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryEnabled: false,
        contacts: [contact],
        user,
      }),
    );
    expect(transactionUserRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(transactionContactRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(transactionContactRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ letters: [saved] }),
    );
  });

  it('rejects an MCP draft when the owning user no longer exists', async () => {
    const transactionLetterRepository = createMockRepository();
    const transactionContactRepository = createMockRepository();
    const transactionUserRepository = createMockRepository();
    const getRepository = jest.fn((entity: unknown) => {
      if (entity === Letter) return transactionLetterRepository;
      if (entity === User) return transactionUserRepository;
      return transactionContactRepository;
    });
    const transaction = jest.fn(
      async (work: (manager: { getRepository: typeof getRepository }) => Promise<unknown>) =>
        work({ getRepository }),
    );
    Object.assign(repository, { manager: { transaction } });
    transactionUserRepository.findOne.mockResolvedValue(null);

    await expect(
      service.insertDraftForMcp('missing-user', {
        title: 'Hello',
        content: 'Draft body',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(transactionLetterRepository.save).not.toHaveBeenCalled();
    expect(transactionContactRepository.find).not.toHaveBeenCalled();
  });

  it('rolls an MCP draft transaction back when relation synchronization fails', async () => {
    const transactionLetterRepository = createMockRepository();
    const transactionContactRepository = createMockRepository();
    const transactionUserRepository = createMockRepository();
    const getRepository = jest.fn((entity: unknown) => {
      if (entity === Letter) return transactionLetterRepository;
      if (entity === User) return transactionUserRepository;
      return transactionContactRepository;
    });
    let rolledBack = false;
    const transaction = jest.fn(
      async (work: (manager: { getRepository: typeof getRepository }) => Promise<unknown>) => {
        try {
          return await work({ getRepository });
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
    );
    Object.assign(repository, { manager: { transaction } });
    const contact = {
      id: 1,
      uuid: 'contact-1',
      iSdelete: 0,
      updatedAt: new Date('2026-07-17T01:02:03.000Z'),
      letters: [] as Letter[],
      user: { uuid: 'user-1' },
    };
    const saved = {
      uuid: 'letter-1',
      title: 'Hello',
      content: 'Draft body',
      user: { uuid: 'user-1' },
    };
    transactionUserRepository.findOne.mockResolvedValue({ id: 9, uuid: 'user-1' });
    transactionContactRepository.find.mockResolvedValue([{ id: 1 }]);
    transactionContactRepository.findOne.mockResolvedValue(contact);
    transactionLetterRepository.create.mockReturnValue(saved);
    transactionLetterRepository.save.mockResolvedValue(saved);
    transactionContactRepository.save.mockRejectedValue(new Error('join write failed'));

    await expect(
      service.insertDraftForMcp('user-1', {
        title: 'Hello',
        content: 'Draft body',
        contactUuids: ['contact-1'],
      }),
    ).rejects.toThrow('join write failed');

    expect(rolledBack).toBe(true);
    expect(transactionLetterRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects deleted or foreign MCP draft contacts before writing', async () => {
    const transactionLetterRepository = createMockRepository();
    const transactionContactRepository = createMockRepository();
    const transactionUserRepository = createMockRepository();
    const getRepository = jest.fn((entity: unknown) => {
      if (entity === Letter) return transactionLetterRepository;
      if (entity === User) return transactionUserRepository;
      return transactionContactRepository;
    });
    const transaction = jest.fn(
      async (work: (manager: { getRepository: typeof getRepository }) => Promise<unknown>) =>
        work({ getRepository }),
    );
    Object.assign(repository, { manager: { transaction } });
    transactionUserRepository.findOne.mockResolvedValue({ id: 9, uuid: 'user-1' });
    transactionContactRepository.find.mockResolvedValue([{ id: 1 }]);
    transactionContactRepository.findOne.mockResolvedValue({
      id: 1,
      uuid: 'contact-1',
      iSdelete: 1,
      letters: [],
      user: { uuid: 'user-1' },
    });

    await expect(
      service.insertDraftForMcp('user-1', {
        title: 'Hello',
        content: 'Draft body',
        contactUuids: ['contact-1'],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(transactionLetterRepository.save).not.toHaveBeenCalled();
  });

  it('locks and updates an MCP draft with optimistic concurrency', async () => {
    const transactionLetterRepository = createMockRepository();
    const transactionContactRepository = createMockRepository();
    const getRepository = jest.fn((entity: unknown) =>
      entity === User
        ? userRepository
        : entity === Letter
          ? transactionLetterRepository
          : transactionContactRepository,
    );
    const transaction = jest.fn(
      async (work: (manager: { getRepository: typeof getRepository }) => Promise<unknown>) =>
        work({ getRepository }),
    );
    Object.assign(repository, { manager: { transaction } });
    const updatedAt = new Date('2026-07-17T01:02:03.000Z');
    const existing = {
      id: 2,
      uuid: 'letter-1',
      updatedAt,
      iSdelete: 0,
      deliveryEnabled: false,
      content: 'Old',
    };
    const merged = { ...existing, content: 'New body', excerpt: 'New body' };
    transactionLetterRepository.findOne
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(merged);
    transactionLetterRepository.merge.mockReturnValue(merged);
    transactionLetterRepository.save.mockResolvedValue(merged);

    await expect(
      service.updateOwnedDraftForMcp('letter-1', 'user-1', updatedAt.toISOString(), {
        content: 'New body',
      }),
    ).resolves.toEqual(merged);

    expect(transactionLetterRepository.findOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(transactionLetterRepository.save).toHaveBeenCalledWith(merged);
  });

  it('advances updatedAt when only MCP contact relations change', async () => {
    const transactionLetterRepository = createMockRepository();
    const transactionContactRepository = createMockRepository();
    const transactionUserRepository = createMockRepository();
    const getRepository = jest.fn((entity: unknown) => {
      if (entity === Letter) return transactionLetterRepository;
      if (entity === User) return transactionUserRepository;
      return transactionContactRepository;
    });
    const transaction = jest.fn(
      async (work: (manager: { getRepository: typeof getRepository }) => Promise<unknown>) =>
        work({ getRepository }),
    );
    Object.assign(repository, { manager: { transaction } });
    const updatedAt = new Date('2026-07-17T01:02:03.000Z');
    const existing = {
      id: 2,
      uuid: 'letter-1',
      updatedAt,
      iSdelete: 0,
      deliveryEnabled: false,
      content: 'Old',
    };
    const contact = {
      id: 1,
      uuid: 'contact-1',
      iSdelete: 0,
      updatedAt,
      letters: [] as Letter[],
    };
    const next = { ...existing };
    transactionUserRepository.findOne.mockResolvedValue({ id: 9, uuid: 'user-1' });
    transactionContactRepository.find.mockResolvedValue([{ id: 1 }]);
    transactionContactRepository.findOne
      .mockResolvedValueOnce(contact)
      .mockResolvedValueOnce({ ...contact, letters: [] });
    transactionLetterRepository.findOne
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce(existing)
      .mockImplementationOnce(async () => next);
    transactionLetterRepository.merge.mockReturnValue(next);
    transactionLetterRepository.save.mockImplementation(async (entity) => entity);
    transactionContactRepository.save.mockImplementation(async (entity) => entity);

    await service.updateOwnedDraftForMcp('letter-1', 'user-1', updatedAt.toISOString(), {
      contactUuids: ['contact-1'],
    });

    expect(next.updatedAt.getTime()).toBeGreaterThan(updatedAt.getTime());
    expect(transactionUserRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(transactionLetterRepository.save).toHaveBeenCalledWith(next);
    expect(transactionContactRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ letters: [next] }),
    );
  });

  it('rejects stale or delivery-enabled MCP draft updates before writing', async () => {
    const transactionLetterRepository = createMockRepository();
    const transactionContactRepository = createMockRepository();
    const getRepository = jest.fn((entity: unknown) =>
      entity === User
        ? userRepository
        : entity === Letter
          ? transactionLetterRepository
          : transactionContactRepository,
    );
    const transaction = jest.fn(
      async (work: (manager: { getRepository: typeof getRepository }) => Promise<unknown>) =>
        work({ getRepository }),
    );
    Object.assign(repository, { manager: { transaction } });
    const updatedAt = new Date('2026-07-17T01:02:03.000Z');
    transactionLetterRepository.findOne.mockResolvedValue({
      uuid: 'letter-1',
      updatedAt,
      iSdelete: 0,
      deliveryEnabled: true,
    });

    await expect(
      service.updateOwnedDraftForMcp('letter-1', 'user-1', updatedAt.toISOString(), {
        title: 'New',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    transactionLetterRepository.findOne.mockResolvedValue({
      uuid: 'letter-1',
      updatedAt,
      iSdelete: 0,
      deliveryEnabled: false,
    });
    await expect(
      service.updateOwnedDraftForMcp('letter-1', 'user-1', '2026-07-17T01:02:04.000Z', {
        title: 'New',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transactionLetterRepository.save).not.toHaveBeenCalled();
  });

  it('soft deletes owned letters', async () => {
    const updatedAt = new Date('2026-07-17T01:02:03.000Z');
    const existing = {
      id: 2,
      uuid: 'letter-1',
      iSdelete: 0,
      updatedAt,
    };
    const linkedContact = {
      id: 1,
      uuid: 'contact-1',
      iSdelete: 0,
      updatedAt,
      letters: [existing],
    };
    contactRepository.find.mockResolvedValue([{ id: 1 }]);
    contactRepository.findOne.mockResolvedValue(linkedContact);
    contactRepository.save.mockImplementation(async (entity) => entity);
    repository.findOne.mockResolvedValueOnce({ id: 2 }).mockResolvedValueOnce(existing);
    repository.save.mockImplementation(async (entity) => entity);

    await service.removeOwned('letter-1', 'user-1');

    expect(userRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        uuid: 'letter-1',
        iSdelete: 1,
        updatedAt: expect.any(Date),
      }),
    );
    expect(repository.save.mock.calls[0][0].updatedAt.getTime()).toBeGreaterThan(
      updatedAt.getTime(),
    );
    expect(contactRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'contact-1', updatedAt: expect.any(Date) }),
    );
    expect(contactRepository.save.mock.calls[0][0].updatedAt.getTime()).toBeGreaterThan(
      updatedAt.getTime(),
    );
  });
  it('rejects managed edits of enabled letters without separately granted delivery permission', async () => {
    const updatedAt = new Date();
    repository.findOne.mockResolvedValue({
      id: 1,
      uuid: 'letter-1',
      updatedAt,
      deliveryEnabled: true,
    });
    await expect(
      service.updateOwned(
        'letter-1',
        'user-1',
        { content: 'Replacement' },
        { expectedUpdatedAt: updatedAt.toISOString(), allowEnabled: false },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.save).not.toHaveBeenCalled();
  });
  it('does not replace a partially delivered body during retries', async () => {
    repository.findOne.mockResolvedValue({
      id: 1,
      uuid: 'letter-1',
      updatedAt: new Date(),
      deliveryEnabled: true,
    });
    deliveryRepository.count.mockResolvedValue(1);
    await expect(
      service.updateOwned('letter-1', 'user-1', { content: 'Replacement' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.save).not.toHaveBeenCalled();
  });
  it('refuses stale web form versions after another client writes', async () => {
    repository.findOne.mockResolvedValue({
      id: 1,
      uuid: 'letter-1',
      updatedAt: new Date(),
      deliveryEnabled: false,
    });
    await expect(
      service.updateOwned(
        'letter-1',
        'user-1',
        { title: 'Stale form' },
        undefined,
        new Date(0).toISOString(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.save).not.toHaveBeenCalled();
  });
  describe('human delivery reviews', () => {
    const user = { id: 9, uuid: 'user-1', createdAt: new Date('2026-11-15T00:00:00Z') };
    const contact = {
      id: 4,
      uuid: 'contact-1',
      name: '家人',
      email: 'family@example.test',
      iSdelete: 0,
      letters: [] as Letter[],
      updatedAt: new Date('2026-11-15T00:00:00Z'),
    };
    const input = {
      title: '给家人的信',
      content: '<p>一切安好</p>',
      contentFormat: 'html' as const,
      inactiveAfterMinutes: 1440,
      contactUuids: ['contact-1'],
      deliveryEnabled: true,
    };
    beforeEach(() => {
      userRepository.findOne.mockResolvedValue(user);
      contactRepository.find.mockResolvedValue([contact]);
      contactRepository.findOne.mockResolvedValue(contact);
      deliveryRepository.count.mockResolvedValue(0);
      repository.create.mockImplementation((value) => ({ ...value }));
      repository.save.mockImplementation(async (value) => ({ ...value, id: 1, uuid: 'letter-1' }));
    });
    it('previews the account creation baseline without saving, sending or checking in', async () => {
      const review = await service.previewDelivery(user.uuid, input);
      expect(review).toMatchObject({
        baselineSource: 'account-created',
        baselineAt: user.createdAt.toISOString(),
        dueAt: '2026-11-16T00:00:00.000Z',
        recipients: [{ uuid: contact.uuid, name: contact.name, email: contact.email }],
      });
      expect(repository.save).not.toHaveBeenCalled();
      expect(checkInRepository.save).not.toHaveBeenCalled();
      expect(resourceService.syncLetterResources).not.toHaveBeenCalled();
    });
    it('requires a matching review for enabled human creates and accepts a reviewed create', async () => {
      const create = { ...input, user, contacts: [contact] };
      await expect(
        service.insert(create as unknown as Parameters<LetterService['insert']>[0], {}),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.save).not.toHaveBeenCalled();
      const review = await service.previewDelivery(user.uuid, input);
      await expect(
        service.insert(create as unknown as Parameters<LetterService['insert']>[0], {
          token: review.token!,
        }),
      ).resolves.toMatchObject({ uuid: 'letter-1' });
    });
    it('rechecks liveness and email addresses inside the create transaction', async () => {
      const review = await service.previewDelivery(user.uuid, input);
      checkInRepository.findOne.mockResolvedValue({ checkedAt: new Date('2026-11-15T01:00:00Z') });
      await expect(
        service.insert(
          { ...input, user, contacts: [contact] } as unknown as Parameters<
            LetterService['insert']
          >[0],
          { token: review.token! },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.save).not.toHaveBeenCalled();
      checkInRepository.findOne.mockResolvedValue(null);
      contactRepository.findOne.mockResolvedValue({ ...contact, email: 'changed@example.test' });
      await expect(
        service.insert(
          { ...input, user, contacts: [contact] } as unknown as Parameters<
            LetterService['insert']
          >[0],
          { token: review.token! },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.save).not.toHaveBeenCalled();
    });
    it('checks ownership and refuses a review for a letter whose delivery has already begun', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(
        service.previewDelivery(user.uuid, { ...input, letterUuid: 'foreign' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      repository.findOne.mockResolvedValue({ id: 1, uuid: 'letter-1', updatedAt: new Date() });
      deliveryRepository.count.mockResolvedValue(1);
      await expect(
        service.previewDelivery(user.uuid, { ...input, letterUuid: 'letter-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.save).not.toHaveBeenCalled();
    });
  });
});
