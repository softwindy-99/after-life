import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { User } from 'src/user/user.entity';
import { Contact } from 'src/contact/contact.entity';
import { CheckIn } from 'src/check-in/check-in.entity';
import { LetterDelivery } from 'src/letter-delivery/letter-delivery.entity';
import { MailService } from 'src/mail/mail.service';
import { createMockRepository } from 'src/test-utils/mock-repository';
import { LetterDeliveryQueueService } from './letter-delivery-queue.service';
import { Letter } from './letter.entity';
import { ResourceService } from 'src/resource/resource.service';

describe('LetterDeliveryQueueService', () => {
  let service: LetterDeliveryQueueService;
  let letterRepository: ReturnType<typeof createMockRepository>;
  let checkInRepository: ReturnType<typeof createMockRepository>;
  let deliveryRepository: ReturnType<typeof createMockRepository>;
  let mailService: { isConfigured: jest.Mock; sendNotification: jest.Mock };
  let resourceService: { signedPath: jest.Mock };

  beforeEach(async () => {
    jest.useFakeTimers();
    letterRepository = createMockRepository();
    checkInRepository = createMockRepository();
    deliveryRepository = createMockRepository();
    const users = createMockRepository();
    users.findOne.mockResolvedValue({ id: 9, uuid: 'user-1' });
    const contacts = createMockRepository();
    contacts.find.mockResolvedValue([]);
    letterRepository.findOne.mockImplementation(async ({ where }: { where: { uuid: string } }) => {
      const candidates = await letterRepository.find.mock.results.at(-1)?.value;
      return candidates?.find((letter: { uuid: string }) => letter.uuid === where.uuid) ?? null;
    });
    Object.assign(letterRepository, {
      manager: {
        transaction: (
          work: (manager: {
            getRepository: (entity: unknown) => typeof letterRepository;
          }) => Promise<unknown>,
        ) =>
          work({
            getRepository: (entity) =>
              entity === Letter
                ? letterRepository
                : entity === CheckIn
                  ? checkInRepository
                  : entity === User
                    ? users
                    : entity === Contact
                      ? contacts
                      : deliveryRepository,
          }),
      },
    });
    mailService = {
      isConfigured: jest.fn().mockReturnValue(true),
      sendNotification: jest.fn(),
    };
    resourceService = {
      signedPath: jest.fn((uuid: string) => `/resource/${uuid}/file?expires=1&signature=ok`),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LetterDeliveryQueueService,
        { provide: getRepositoryToken(Letter), useValue: letterRepository },
        { provide: getRepositoryToken(CheckIn), useValue: checkInRepository },
        {
          provide: getRepositoryToken(LetterDelivery),
          useValue: deliveryRepository,
        },
        { provide: MailService, useValue: mailService },
        { provide: ResourceService, useValue: resourceService },
      ],
    }).compile();

    service = moduleRef.get(LetterDeliveryQueueService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('sends due letters to contact email addresses', async () => {
    const now = new Date('2026-05-13T00:00:00.000Z');
    const letter = {
      uuid: 'letter-1',
      title: 'Hello',
      content: 'World',
      inactiveAfterMinutes: 60,
      user: {
        uuid: 'user-1',
        createdAt: new Date('2026-05-12T20:00:00.000Z'),
      },
      contacts: [
        { uuid: 'contact-1', email: 'alice@example.com', iSdelete: 0 },
        { uuid: 'contact-2', email: 'deleted@example.com', iSdelete: 1 },
      ],
    };

    letterRepository.find.mockResolvedValue([letter]);
    checkInRepository.findOne.mockResolvedValue({
      checkedAt: new Date('2026-05-12T22:00:00.000Z'),
    });
    deliveryRepository.findOne.mockResolvedValue(null);
    deliveryRepository.create.mockImplementation((value) => value);
    deliveryRepository.save.mockResolvedValue({});
    mailService.sendNotification.mockResolvedValue({
      accepted: ['alice@example.com'],
      rejected: [],
    });
    letterRepository.save.mockResolvedValue(letter);

    await expect(service.processDueLetters(now)).resolves.toEqual({
      checked: 1,
      sent: 1,
      failed: 0,
    });

    expect(mailService.sendNotification).toHaveBeenCalledWith({
      to: 'alice@example.com',
      subject: 'Hello',
      text: 'World',
    });
    expect(mailService.sendNotification).toHaveBeenCalledTimes(1);
    expect(deliveryRepository.create).toHaveBeenCalledWith({
      letter,
      contact: letter.contacts[0],
      user: letter.user,
      recipient: 'alice@example.com',
      status: 'sent',
      error: null,
      sentAt: expect.any(Date),
    });
  });

  it.each(['', '/api'])('sends signed rich HTML links with API base prefix %s', async (prefix) => {
    const previousBase = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = `https://afterlife.example${prefix}`;
    try {
      const uuid = '22222222-2222-4222-8222-222222222222';
      const now = new Date('2026-05-13T00:00:00.000Z');
      letterRepository.find.mockResolvedValue([
        {
          uuid: 'letter-1',
          title: 'Hello',
          contentFormat: 'html',
          content: `<p>Hi</p><img src="/resource/${uuid}">`,
          inactiveAfterMinutes: 60,
          user: { uuid: 'user-1', iSdelete: 0, createdAt: new Date('2026-05-12T20:00:00.000Z') },
          contacts: [{ uuid: 'contact-1', email: 'alice@example.com', iSdelete: 0 }],
        },
      ]);
      checkInRepository.findOne.mockResolvedValue(null);
      deliveryRepository.findOne.mockResolvedValue(null);
      deliveryRepository.create.mockImplementation((value) => value);
      deliveryRepository.save.mockResolvedValue({});
      mailService.sendNotification.mockResolvedValue({ accepted: ['alice@example.com'] });
      await service.processDueLetters(now);
      expect(mailService.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Hi',
          html: `<p>Hi</p><img src="https://afterlife.example${prefix}/resource/${uuid}/file?expires=1&amp;signature=ok">`,
        }),
      );
      expect(resourceService.signedPath).toHaveBeenCalledWith(uuid, 30 * 86400);
    } finally {
      if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = previousBase;
    }
  });

  it('does not start retention until every recipient has a successful delivery', async () => {
    const now = new Date('2026-05-13T00:00:00.000Z');
    letterRepository.find.mockResolvedValue([
      {
        uuid: 'letter-1',
        title: 'Hello',
        content: 'Body',
        contentFormat: 'plain_text',
        inactiveAfterMinutes: 60,
        user: { uuid: 'user-1', iSdelete: 0, createdAt: new Date('2026-05-12T20:00:00.000Z') },
        contacts: [
          { uuid: 'contact-1', email: 'a@example.com', iSdelete: 0 },
          { uuid: 'contact-2', email: 'b@example.com', iSdelete: 0 },
        ],
      },
    ]);
    checkInRepository.findOne.mockResolvedValue(null);
    deliveryRepository.findOne.mockResolvedValue(null);
    deliveryRepository.create.mockImplementation((value) => value);
    deliveryRepository.save.mockResolvedValue({});
    mailService.sendNotification
      .mockResolvedValueOnce({ accepted: ['a@example.com'] })
      .mockResolvedValueOnce({ accepted: [], rejected: ['b@example.com'] });

    await expect(service.processDueLetters(now)).resolves.toEqual({
      checked: 1,
      sent: 1,
      failed: 1,
    });
    expect(letterRepository.save).not.toHaveBeenCalled();
    expect(deliveryRepository.save).toHaveBeenCalledTimes(2);
  });

  it('skips processing when mail is not configured', async () => {
    mailService.isConfigured.mockReturnValue(false);

    await expect(service.processDueLetters()).resolves.toEqual({
      checked: 0,
      sent: 0,
      failed: 0,
    });

    expect(letterRepository.find).not.toHaveBeenCalled();
    expect(mailService.sendNotification).not.toHaveBeenCalled();
  });

  it('does not send letters before the inactive window is reached', async () => {
    const now = new Date('2026-05-13T00:00:00.000Z');
    letterRepository.find.mockResolvedValue([
      {
        uuid: 'letter-1',
        inactiveAfterMinutes: 60,
        user: { uuid: 'user-1', createdAt: now },
        contacts: [{ uuid: 'contact-1', email: 'alice@example.com' }],
      },
    ]);
    checkInRepository.findOne.mockResolvedValue({
      checkedAt: new Date('2026-05-12T23:30:00.000Z'),
    });

    await expect(service.processDueLetters(now)).resolves.toEqual({
      checked: 1,
      sent: 0,
      failed: 0,
    });
    expect(mailService.sendNotification).not.toHaveBeenCalled();
  });

  it('skips contacts already successfully delivered', async () => {
    const now = new Date('2026-05-13T00:00:00.000Z');
    letterRepository.find.mockResolvedValue([
      {
        uuid: 'letter-1',
        inactiveAfterMinutes: 60,
        user: {
          uuid: 'user-1',
          createdAt: new Date('2026-05-12T20:00:00.000Z'),
        },
        contacts: [{ uuid: 'contact-1', email: 'alice@example.com' }],
      },
    ]);
    checkInRepository.findOne.mockResolvedValue(null);
    deliveryRepository.findOne.mockResolvedValue({ uuid: 'delivery-1' });

    await expect(service.processDueLetters(now)).resolves.toEqual({
      checked: 1,
      sent: 0,
      failed: 0,
    });
    expect(mailService.sendNotification).not.toHaveBeenCalled();
  });

  it('never sends to a soft-deleted contact that remains linked', async () => {
    const now = new Date('2026-05-13T00:00:00.000Z');
    letterRepository.find.mockResolvedValue([
      {
        uuid: 'letter-1',
        inactiveAfterMinutes: 60,
        user: {
          uuid: 'user-1',
          createdAt: new Date('2026-05-12T20:00:00.000Z'),
        },
        contacts: [
          {
            uuid: 'contact-1',
            email: 'deleted@example.com',
            iSdelete: 1,
          },
        ],
      },
    ]);

    await expect(service.processDueLetters(now)).resolves.toEqual({
      checked: 1,
      sent: 0,
      failed: 0,
    });
    expect(checkInRepository.findOne).not.toHaveBeenCalled();
    expect(mailService.sendNotification).not.toHaveBeenCalled();
  });
  it('rechecks the latest check-in after scanning a due candidate', async () => {
    const now = new Date('2026-05-13T00:00:00Z');
    const letter = {
      id: 1,
      uuid: 'letter-1',
      deliveryEnabled: true,
      inactiveAfterMinutes: 60,
      user: { uuid: 'user-1', createdAt: new Date('2026-05-12') },
      contacts: [{ uuid: 'contact-1', email: 'a@example.com' }],
    };
    letterRepository.find.mockResolvedValue([letter]);
    checkInRepository.findOne.mockResolvedValue({ checkedAt: now });
    await expect(service.processDueLetters(now)).resolves.toMatchObject({ sent: 0, failed: 0 });
    expect(mailService.sendNotification).not.toHaveBeenCalled();
    expect(letterRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });
  it('uses current content rather than the outer-scan snapshot and never overwrites it', async () => {
    const now = new Date('2026-05-13T00:00:00Z');
    const candidate = {
      id: 1,
      uuid: 'letter-1',
      title: 'Old',
      content: 'Old',
      deliveryEnabled: true,
      inactiveAfterMinutes: 60,
      user: { uuid: 'user-1', createdAt: new Date('2026-05-12') },
      contacts: [{ uuid: 'contact-1', email: 'a@example.com' }],
    };
    letterRepository.find.mockResolvedValue([candidate]);
    letterRepository.findOne.mockResolvedValue({ ...candidate, title: 'New', content: 'New body' });
    checkInRepository.findOne.mockResolvedValue(null);
    deliveryRepository.findOne.mockResolvedValue(null);
    mailService.sendNotification.mockResolvedValue({ accepted: ['a@example.com'] });
    await expect(service.processDueLetters(now)).resolves.toMatchObject({ sent: 1 });
    expect(mailService.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'New', text: 'New body' }),
    );
    expect(letterRepository.save).not.toHaveBeenCalled();
    expect(letterRepository.update).toHaveBeenCalledWith({ id: 1 }, { lastTriggeredAt: now });
  });
});
