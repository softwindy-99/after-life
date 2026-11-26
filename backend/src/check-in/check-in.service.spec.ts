import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { User } from 'src/user/user.entity';
import { createMockRepository } from 'src/test-utils/mock-repository';
import { CheckIn } from './check-in.entity';
import { CheckInService } from './check-in.service';
import { NotFoundException } from '@nestjs/common';

describe('CheckInService', () => {
  let service: CheckInService;
  let checkInRepository: ReturnType<typeof createMockRepository>;
  let userRepository: ReturnType<typeof createMockRepository>;

  beforeEach(async () => {
    checkInRepository = createMockRepository();
    userRepository = createMockRepository();
    Object.assign(checkInRepository, {
      manager: {
        transaction: (
          work: (manager: {
            getRepository: (entity: unknown) => typeof checkInRepository;
          }) => Promise<unknown>,
        ) =>
          work({
            getRepository: (entity) => (entity === User ? userRepository : checkInRepository),
          }),
      },
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        CheckInService,
        { provide: getRepositoryToken(CheckIn), useValue: checkInRepository },
        { provide: getRepositoryToken(User), useValue: userRepository },
      ],
    }).compile();

    service = moduleRef.get(CheckInService);
  });

  it('creates a check-in for an active user', async () => {
    const user = { uuid: 'user-1' };
    const created = { user, source: 'web' };
    userRepository.findOne.mockResolvedValue(user);
    checkInRepository.create.mockReturnValue(created);
    checkInRepository.save.mockResolvedValue({
      ...created,
      uuid: 'check-in-1',
    });

    await expect(service.create('user-1', ' web ')).resolves.toEqual({
      ...created,
      uuid: 'check-in-1',
    });

    expect(userRepository.findOne).toHaveBeenCalledWith({
      where: { uuid: 'user-1', iSdelete: 0 },
      select: { id: true, uuid: true, createdAt: true },
      loadEagerRelations: false,
      lock: { mode: 'pessimistic_write' },
    });
    expect(checkInRepository.create).toHaveBeenCalledWith({
      user,
      checkedAt: expect.any(Date),
      source: 'web',
    });
  });

  it('rejects check-in when user is missing', async () => {
    userRepository.findOne.mockResolvedValue(null);

    await expect(service.create('user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns latest check-in status', async () => {
    const checkIn = { uuid: 'check-in-1', checkedAt: new Date() };
    checkInRepository.findOne.mockResolvedValue(checkIn);

    await expect(service.getStatus('user-1')).resolves.toEqual({
      lastSeenAt: checkIn.checkedAt,
      checkIn,
      baselineAt: checkIn.checkedAt,
      baselineSource: 'check-in',
    });
  });
  it('records actual interaction time and deduplicates retries without renewing it', async () => {
    const observed = new Date(Math.floor((Date.now() - 120000) / 1000) * 1000);
    userRepository.findOne.mockResolvedValue({ id: 1, uuid: 'user-1' });
    checkInRepository.findOne.mockResolvedValue(null);
    checkInRepository.create.mockImplementation((value) => value);
    checkInRepository.save.mockImplementation(async (value) => value);
    await expect(
      service.createDelegated('user-1', 'agent-1', 'event-1', observed.toISOString()),
    ).resolves.toMatchObject({ recorded: true, checkedAt: observed.toISOString() });
    const stored = checkInRepository.save.mock.calls[0][0];
    expect(stored.source).toBe('mcp:agent-1');
    checkInRepository.findOne.mockResolvedValue(stored);
    await expect(
      service.createDelegated('user-1', 'agent-1', 'event-1', observed.toISOString()),
    ).resolves.toMatchObject({ recorded: false, checkedAt: observed.toISOString() });
    await expect(
      service.createDelegated('user-1', 'agent-1', 'event-1', new Date().toISOString()),
    ).rejects.toThrow('event time cannot change');
    expect(checkInRepository.save).toHaveBeenCalledTimes(1);
  });
  it.each([-360000, 60000])('rejects expired or future human activity (%s ms)', async (offset) => {
    userRepository.findOne.mockResolvedValue({ id: 1, uuid: 'user-1' });
    checkInRepository.findOne.mockResolvedValue(null);
    await expect(
      service.createDelegated(
        'user-1',
        'agent-1',
        'event',
        new Date(Date.now() + offset).toISOString(),
      ),
    ).rejects.toThrow('last five minutes');
    expect(checkInRepository.save).not.toHaveBeenCalled();
  });
});
