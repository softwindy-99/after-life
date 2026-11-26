import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Contact } from './contact.entity';
import { ContactService } from './contact.service';
import { createMockRepository } from 'src/test-utils/mock-repository';
import { Letter } from 'src/letter/letter.entity';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { User } from 'src/user/user.entity';

function createCountQueryBuilder(rows: Array<Record<string, string>>) {
  const builder: Record<string, jest.Mock> = {};
  for (const method of ['innerJoin', 'select', 'addSelect', 'where', 'andWhere', 'groupBy']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.getRawMany = jest.fn().mockResolvedValue(rows);
  return builder;
}

describe('ContactService', () => {
  let service: ContactService;
  let repository: ReturnType<typeof createMockRepository>;
  let letterRepository: ReturnType<typeof createMockRepository>;
  let userRepository: ReturnType<typeof createMockRepository>;

  beforeEach(async () => {
    repository = createMockRepository();
    letterRepository = createMockRepository();
    letterRepository.find.mockResolvedValue([]);
    userRepository = createMockRepository();
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
                if (entity === Contact) return repository;
                if (entity === User) return userRepository;
                return letterRepository;
              },
            }),
        ),
      },
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ContactService,
        { provide: getRepositoryToken(Contact), useValue: repository },
        { provide: getRepositoryToken(Letter), useValue: letterRepository },
      ],
    }).compile();

    service = moduleRef.get(ContactService);
  });

  it('creates a contact with defaults and display summary', async () => {
    const input = {
      name: 'Bob',
      email: 'bob@example.com',
      phone: '123',
      user: { uuid: 'user-1' },
    };
    const created = {
      ...input,
      user: { id: 9, uuid: 'user-1' },
      letters: [] as unknown[],
      extra: null as unknown,
      displaySummary: 'bob@example.com | 123',
    };

    repository.create.mockReturnValue(created);
    repository.save.mockResolvedValue({ ...created, uuid: 'contact-1' });

    await expect(service.insert(input as any)).resolves.toEqual({
      ...created,
      uuid: 'contact-1',
    });

    expect(repository.create).toHaveBeenCalledWith(created);
  });

  it('advances linked letter versions when creating a related contact', async () => {
    const updatedAt = new Date('2026-07-17T01:02:03.000Z');
    const lockedLetter = {
      id: 2,
      uuid: 'letter-1',
      iSdelete: 0,
      updatedAt,
      deliveryEnabled: false,
    };
    const input = {
      name: 'Bob',
      email: 'bob@example.com',
      user: { uuid: 'user-1' },
      letters: [{ uuid: 'letter-1' } as Letter],
    };
    const created = {
      ...input,
      user: { id: 9, uuid: 'user-1' },
      letters: [lockedLetter],
      extra: null as Record<string, unknown> | null,
      displaySummary: 'bob@example.com',
    };
    letterRepository.find.mockResolvedValue([{ id: 2 }]);
    letterRepository.findOne.mockResolvedValue(lockedLetter);
    letterRepository.save.mockImplementation(async (entity) => entity);
    repository.create.mockReturnValue(created);
    repository.save.mockResolvedValue({ ...created, uuid: 'contact-1' });

    await service.insert(input as any);

    expect(letterRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'letter-1', updatedAt: expect.any(Date) }),
    );
    expect(letterRepository.save.mock.calls[0][0].updatedAt.getTime()).toBeGreaterThan(
      updatedAt.getTime(),
    );
  });

  it('finds contacts by user', async () => {
    repository.find.mockResolvedValue([{ uuid: 'contact-1' }]);

    await expect(service.findByUser('user-1')).resolves.toEqual([{ uuid: 'contact-1' }]);

    expect(repository.find).toHaveBeenCalledWith({
      where: { user: { uuid: 'user-1' }, iSdelete: 0 },
      relations: { user: true, letters: true },
      order: { createdAt: 'DESC' },
    });
  });

  it('returns a projected, bounded page for MCP consumers', async () => {
    const contact = { id: 1, uuid: 'contact-1' };
    const queryBuilder = createCountQueryBuilder([{ contactId: '1', relationCount: '2' }]);
    repository.findAndCount.mockResolvedValue([[contact], 1]);
    letterRepository.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(service.findPageByUser('user-1', 2, 20)).resolves.toEqual({
      data: [{ contact, linkedLetterCount: 2 }],
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
    expect(repository.findAndCount.mock.calls[0][0].select).not.toHaveProperty('note');
    expect(repository.findAndCount.mock.calls[0][0]).not.toHaveProperty('relations');
    expect(queryBuilder.getRawMany).toHaveBeenCalledTimes(1);
  });

  it('bounds MCP contact relations while preserving the total count', async () => {
    const contact = { id: 1, uuid: 'contact-1' };
    const letters = [
      { id: 2, uuid: 'letter-1', iSdelete: 0 },
      { id: 3, uuid: 'letter-2', iSdelete: 0 },
    ];
    repository.findOne.mockResolvedValue(contact);
    letterRepository.findAndCount.mockResolvedValue([letters, 3]);

    await expect(service.findOwnedOneForMcp('contact-1', 'user-1', 2)).resolves.toEqual({
      contact: { ...contact, letters },
      linkedLetterCount: 3,
      letterUuidsTruncated: true,
    });
    expect(letterRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2, loadEagerRelations: false }),
    );
  });

  it('returns null when updating a non-owned contact', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.updateOwned('contact-1', 'user-1', { name: 'Next' })).resolves.toBeNull();
  });

  it('rebuilds the display summary on update', async () => {
    const updatedAt = new Date('2026-07-17T01:02:03.000Z');
    const existing = {
      id: 1,
      uuid: 'contact-1',
      updatedAt,
      email: 'old@example.com',
      phone: null as string | null,
      name: 'Old',
    };
    const merged = {
      ...existing,
      phone: '123',
      displaySummary: 'old@example.com | 123',
    };

    repository.findOne
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing)
      .mockImplementationOnce(async () => merged);
    repository.merge.mockReturnValue(merged);
    repository.save.mockResolvedValue(merged);
    const now = jest.spyOn(Date, 'now').mockReturnValue(updatedAt.getTime());

    await expect(service.updateOwned('contact-1', 'user-1', { phone: '123' })).resolves.toEqual(
      merged,
    );
    now.mockRestore();

    expect(repository.merge).toHaveBeenCalledWith(existing, {
      phone: '123',
      displaySummary: 'old@example.com | 123',
    });
    expect(merged.updatedAt.getTime()).toBe(updatedAt.getTime() + 1);
  });

  it('rejects a REST address change while linked delivery is enabled', async () => {
    const updatedAt = new Date('2026-07-17T01:02:03.000Z');
    const existing = {
      id: 1,
      uuid: 'contact-1',
      iSdelete: 0,
      updatedAt,
      email: 'old@example.com',
      phone: null as string | null,
    };
    const linkedLetter = {
      id: 2,
      uuid: 'letter-1',
      iSdelete: 0,
      updatedAt,
      deliveryEnabled: true,
    };
    repository.findOne.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(existing);
    letterRepository.findOne.mockResolvedValue(linkedLetter);

    await expect(
      service.updateOwned('contact-1', 'user-1', { email: 'new@example.com' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(userRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects clearing every contact method inside the transaction', async () => {
    const existing = {
      id: 1,
      uuid: 'contact-1',
      iSdelete: 0,
      updatedAt: new Date('2026-07-17T01:02:03.000Z'),
      email: 'old@example.com',
      phone: null as string | null,
    };
    repository.findOne.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(existing);

    await expect(
      service.updateOwned('contact-1', 'user-1', { email: null, phone: null }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.save).not.toHaveBeenCalled();
  });

  it('serializes REST letter relation changes and advances updatedAt', async () => {
    const updatedAt = new Date('2026-07-17T01:02:03.000Z');
    const existing = {
      id: 1,
      uuid: 'contact-1',
      iSdelete: 0,
      updatedAt,
      email: 'old@example.com',
      phone: null as string | null,
    };
    const desiredLetter = {
      id: 2,
      uuid: 'letter-1',
      iSdelete: 0,
      updatedAt,
      deliveryEnabled: false,
    };
    const saved = { ...existing, letters: [desiredLetter] };
    repository.findOne
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ ...existing, letters: [] })
      .mockImplementationOnce(async () => repository.save.mock.calls[0][0]);
    repository.merge.mockImplementation((entity, payload) => ({ ...entity, ...payload }));
    repository.save.mockImplementation(async (entity) => entity);
    letterRepository.find.mockResolvedValue([{ id: 2 }]);
    letterRepository.findOne.mockResolvedValue(desiredLetter);

    await expect(
      service.updateOwned('contact-1', 'user-1', {
        letters: [{ uuid: 'letter-1' } as Letter],
      }),
    ).resolves.toEqual(expect.objectContaining({ uuid: saved.uuid, letters: [desiredLetter] }));

    expect(userRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(repository.findOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(letterRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(userRepository.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      repository.findOne.mock.invocationCallOrder[0],
    );
    expect(repository.findOne.mock.invocationCallOrder[1]).toBeLessThan(
      letterRepository.findOne.mock.invocationCallOrder[0],
    );
    const persisted = repository.save.mock.calls[0][0];
    expect(persisted.letters).toEqual([desiredLetter]);
    expect(persisted.updatedAt.getTime()).toBeGreaterThan(updatedAt.getTime());
    expect(letterRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'letter-1', updatedAt: expect.any(Date) }),
    );
    expect(letterRepository.save.mock.calls[0][0].updatedAt.getTime()).toBeGreaterThan(
      updatedAt.getTime(),
    );
  });

  it('locks and updates an MCP contact after rechecking delivery state', async () => {
    const transactionContactRepository = createMockRepository();
    const transactionLetterRepository = createMockRepository();
    transactionLetterRepository.find.mockResolvedValue([]);
    const transactionUserRepository = createMockRepository();
    const transaction = jest.fn(
      async (
        work: (manager: {
          getRepository: (entity: unknown) => typeof transactionContactRepository;
        }) => Promise<unknown>,
      ) =>
        work({
          getRepository: (entity) => {
            if (entity === Contact) return transactionContactRepository;
            if (entity === User) return transactionUserRepository;
            return transactionLetterRepository;
          },
        }),
    );
    Object.assign(repository, { manager: { transaction } });
    const updatedAt = new Date('2026-07-17T01:02:03.000Z');
    const existing = {
      id: 1,
      uuid: 'contact-1',
      iSdelete: 0,
      updatedAt,
      email: 'old@example.com',
      phone: null as string | null,
    };
    const merged = {
      ...existing,
      email: 'new@example.com',
      displaySummary: 'new@example.com',
    };
    transactionUserRepository.findOne.mockResolvedValue({ id: 9, uuid: 'user-1' });
    transactionContactRepository.findOne
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(merged);
    transactionLetterRepository.findOne.mockResolvedValue(null);
    transactionContactRepository.merge.mockReturnValue(merged);
    transactionContactRepository.save.mockResolvedValue(merged);

    await expect(
      service.updateOwnedForMcp('contact-1', 'user-1', updatedAt.toISOString(), {
        email: 'new@example.com',
      }),
    ).resolves.toEqual(merged);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transactionContactRepository.findOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(transactionLetterRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deliveryEnabled: true,
          contacts: { id: 1 },
        }),
        loadEagerRelations: false,
      }),
    );
    expect(transactionContactRepository.save).toHaveBeenCalledWith(merged);
  });

  it('rejects a stale MCP contact update before writing', async () => {
    const transactionContactRepository = createMockRepository();
    const transactionLetterRepository = createMockRepository();
    transactionLetterRepository.find.mockResolvedValue([]);
    const transaction = jest.fn(
      async (
        work: (manager: {
          getRepository: (entity: unknown) => typeof transactionContactRepository;
        }) => Promise<unknown>,
      ) =>
        work({
          getRepository: (entity) =>
            entity === User ? userRepository : transactionContactRepository,
        }),
    );
    Object.assign(repository, { manager: { transaction } });
    const stale = {
      id: 1,
      uuid: 'contact-1',
      iSdelete: 0,
      updatedAt: new Date('2026-07-17T01:02:03.000Z'),
      email: 'old@example.com',
    };
    transactionContactRepository.findOne
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(stale);

    await expect(
      service.updateOwnedForMcp('contact-1', 'user-1', '2026-07-17T01:02:04.000Z', { name: 'New' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transactionContactRepository.save).not.toHaveBeenCalled();
    expect(transactionLetterRepository.save).not.toHaveBeenCalled();
  });

  it('rejects an MCP address update linked to enabled delivery', async () => {
    const transactionContactRepository = createMockRepository();
    const transactionLetterRepository = createMockRepository();
    transactionLetterRepository.find.mockResolvedValue([]);
    const transactionUserRepository = createMockRepository();
    const transaction = jest.fn(
      async (
        work: (manager: {
          getRepository: (entity: unknown) => typeof transactionContactRepository;
        }) => Promise<unknown>,
      ) =>
        work({
          getRepository: (entity) => {
            if (entity === Contact) return transactionContactRepository;
            if (entity === User) return transactionUserRepository;
            return transactionLetterRepository;
          },
        }),
    );
    Object.assign(repository, { manager: { transaction } });
    const updatedAt = new Date('2026-07-17T01:02:03.000Z');
    transactionUserRepository.findOne.mockResolvedValue({ id: 9, uuid: 'user-1' });
    transactionContactRepository.findOne.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({
      id: 1,
      uuid: 'contact-1',
      iSdelete: 0,
      updatedAt,
      email: 'old@example.com',
    });
    transactionLetterRepository.findOne.mockResolvedValue({
      id: 2,
      uuid: 'letter-1',
      deliveryEnabled: true,
    });

    await expect(
      service.updateOwnedForMcp('contact-1', 'user-1', updatedAt.toISOString(), {
        email: 'new@example.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transactionContactRepository.save).not.toHaveBeenCalled();
  });

  it('soft deletes owned contacts', async () => {
    const updatedAt = new Date('2026-07-17T01:02:03.000Z');
    const existing = {
      id: 1,
      uuid: 'contact-1',
      iSdelete: 0,
      updatedAt,
    };
    const linkedLetter = {
      id: 2,
      uuid: 'letter-1',
      iSdelete: 0,
      updatedAt,
      deliveryEnabled: false,
    };
    repository.findOne
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ id: 1, uuid: 'contact-1', letters: [linkedLetter] });
    repository.save.mockImplementation(async (entity) => entity);
    letterRepository.find.mockResolvedValue([{ id: 2 }]);
    letterRepository.findOne.mockResolvedValue(linkedLetter);
    letterRepository.save.mockImplementation(async (entity) => entity);

    await service.removeOwned('contact-1', 'user-1');

    expect(userRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        uuid: 'contact-1',
        iSdelete: 1,
        updatedAt: expect.any(Date),
      }),
    );
    expect(repository.save.mock.calls[0][0].updatedAt.getTime()).toBeGreaterThan(
      updatedAt.getTime(),
    );
    expect(letterRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'letter-1', updatedAt: expect.any(Date) }),
    );
    expect(letterRepository.save.mock.calls[0][0].updatedAt.getTime()).toBeGreaterThan(
      updatedAt.getTime(),
    );
  });
  it('refuses stale web form versions after another client writes', async () => {
    repository.findOne.mockResolvedValue({
      id: 1,
      uuid: 'contact-1',
      updatedAt: new Date(),
      deliveryEnabled: false,
    });
    await expect(
      service.updateOwned('contact-1', 'user-1', { name: 'Stale form' }, new Date(0).toISOString()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.save).not.toHaveBeenCalled();
  });
});
