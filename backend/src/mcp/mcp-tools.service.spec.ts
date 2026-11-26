import { ConflictException, NotFoundException } from '@nestjs/common';
import { McpToolsService } from './mcp-tools.service';

describe('McpToolsService', () => {
  const userUuid = '11111111-1111-4111-8111-111111111111';
  const contactUuid = '22222222-2222-4222-8222-222222222222';
  const letterUuid = '33333333-3333-4333-8333-333333333333';
  const createdAt = new Date('2026-07-01T00:00:00.000Z');
  const updatedAt = new Date('2026-07-02T00:00:00.000Z');

  let userService: { findOne: jest.Mock };
  let contactService: {
    findPageByUser: jest.Mock;
    findOwnedOneForMcp: jest.Mock;
    insert: jest.Mock;
    updateOwnedForMcp: jest.Mock;
  };
  let letterService: {
    findPageByUser: jest.Mock;
    findOwnedOneForMcp: jest.Mock;
    insertDraftForMcp: jest.Mock;
    updateOwnedDraftForMcp: jest.Mock;
  };
  let checkInService: { getStatus: jest.Mock };
  let service: McpToolsService;

  const contact = (overrides: Record<string, unknown> = {}) => ({
    id: 99,
    uuid: contactUuid,
    name: 'Alice',
    email: 'alice@example.com',
    phone: null as string | null,
    note: 'private note',
    displaySummary: 'alice@example.com',
    extra: { secret: true },
    letters: [] as unknown[],
    user: { uuid: userUuid, password: 'hidden' },
    iSdelete: 0,
    createdAt,
    updatedAt,
    ...overrides,
  });

  const letter = (overrides: Record<string, unknown> = {}) => ({
    id: 88,
    uuid: letterUuid,
    title: 'Hello',
    content: 'Stored body',
    excerpt: 'Stored body',
    contentFormat: 'markdown',
    resourceCount: 0,
    extra: { secret: true },
    deliveryEnabled: false,
    inactiveAfterMinutes: null as number | null,
    lastTriggeredAt: null as Date | null,
    contacts: [] as unknown[],
    user: { uuid: userUuid, password: 'hidden' },
    iSdelete: 0,
    createdAt,
    updatedAt,
    ...overrides,
  });

  beforeEach(() => {
    userService = { findOne: jest.fn() };
    contactService = {
      findPageByUser: jest.fn(),
      findOwnedOneForMcp: jest.fn(),
      insert: jest.fn(),
      updateOwnedForMcp: jest.fn(),
    };
    letterService = {
      findPageByUser: jest.fn(),
      findOwnedOneForMcp: jest.fn(),
      insertDraftForMcp: jest.fn(),
      updateOwnedDraftForMcp: jest.fn(),
    };
    checkInService = { getStatus: jest.fn() };
    service = new McpToolsService(
      userService as any,
      contactService as any,
      letterService as any,
      checkInService as any,
    );
  });

  it('returns a profile DTO without sensitive entity fields', async () => {
    userService.findOne.mockResolvedValue({
      id: 1,
      uuid: userUuid,
      username: 'User',
      email: 'user@example.com',
      password: 'secret',
      avatar: 'base64',
      role: { name: 'user', permissions: [{ name: 'self' }] },
    });

    await expect(service.getProfile(userUuid)).resolves.toEqual({
      profile: {
        uuid: userUuid,
        username: 'User',
        email: 'user@example.com',
        roleName: 'user',
      },
    });
  });

  it('returns bounded contact summaries without notes or raw entities', async () => {
    contactService.findPageByUser.mockResolvedValue({
      data: [
        {
          contact: contact(),
          linkedLetterCount: 1,
        },
      ],
      total: 1,
    });

    await expect(service.listContacts(userUuid, 1, 20)).resolves.toEqual({
      items: [
        {
          uuid: contactUuid,
          name: 'Alice',
          email: 'alice@example.com',
          phone: null,
          linkedLetterCount: 1,
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('does not reveal whether a contact belongs to another user', async () => {
    contactService.findOwnedOneForMcp.mockResolvedValue(null);

    await expect(service.getContact(userUuid, contactUuid)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('excludes soft-deleted letters from contact detail', async () => {
    contactService.findOwnedOneForMcp.mockResolvedValue({
      contact: contact({ letters: [{ uuid: letterUuid, iSdelete: 0 }] }),
      linkedLetterCount: 2,
      letterUuidsTruncated: true,
    });

    await expect(service.getContact(userUuid, contactUuid)).resolves.toMatchObject({
      contact: {
        linkedLetterCount: 2,
        letterUuids: [letterUuid],
        letterUuidsTruncated: true,
      },
    });
    expect(contactService.findOwnedOneForMcp).toHaveBeenCalledWith(contactUuid, userUuid, 100);
  });

  it('refuses recipient address changes linked to enabled delivery', async () => {
    contactService.updateOwnedForMcp.mockRejectedValue(new ConflictException());

    await expect(
      service.updateContact(userUuid, contactUuid, {
        expectedUpdatedAt: updatedAt.toISOString(),
        email: 'new@example.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(contactService.updateOwnedForMcp).toHaveBeenCalled();
  });

  it('updates non-address contact fields with an optimistic precondition', async () => {
    const updated = contact({ name: 'Alice Smith', note: null });
    contactService.updateOwnedForMcp.mockResolvedValue(updated);
    contactService.findOwnedOneForMcp.mockResolvedValue({
      contact: updated,
      linkedLetterCount: 0,
      letterUuidsTruncated: false,
    });

    await expect(
      service.updateContact(userUuid, contactUuid, {
        expectedUpdatedAt: updatedAt.toISOString(),
        name: 'Alice Smith',
        note: null,
      }),
    ).resolves.toMatchObject({ contact: { name: 'Alice Smith', note: null } });
    expect(contactService.updateOwnedForMcp).toHaveBeenCalledWith(
      contactUuid,
      userUuid,
      updatedAt.toISOString(),
      {
        name: 'Alice Smith',
        email: undefined,
        phone: undefined,
        note: null,
      },
      false,
    );
  });

  it('returns letter summaries without stored bodies', async () => {
    letterService.findPageByUser.mockResolvedValue({
      data: [
        {
          letter: letter(),
          contactCount: 1,
        },
      ],
      total: 1,
    });

    const result = await service.listLetters(userUuid, 1, 20);

    expect(result.items[0]).toEqual({
      uuid: letterUuid,
      title: 'Hello',
      excerpt: 'Stored body',
      contentFormat: 'markdown',
      deliveryEnabled: false,
      inactiveAfterMinutes: null,
      contactCount: 1,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });
    expect(result.items[0]).not.toHaveProperty('content');
    expect(result.items[0]).not.toHaveProperty('user');
  });

  it('bounds detail content and excludes soft-deleted contact data', async () => {
    letterService.findOwnedOneForMcp.mockResolvedValue({
      letter: letter({
        content: 'x'.repeat(20_001),
        contacts: [contact()],
      }),
      contactCount: 2,
      contactsTruncated: true,
    });

    const result = await service.getLetter(userUuid, letterUuid);

    expect(result.letter.content).toHaveLength(20_000);
    expect(result.letter.contentTruncated).toBe(true);
    expect(result.letter.contacts).toEqual([
      {
        uuid: contactUuid,
        name: 'Alice',
        email: 'alice@example.com',
        phone: null,
      },
    ]);
    expect(result.letter.contactCount).toBe(2);
    expect(result.letter.contactsTruncated).toBe(true);
    expect(letterService.findOwnedOneForMcp).toHaveBeenCalledWith(letterUuid, userUuid, 100);
  });

  it('creates a letter draft with delivery forced off and owned contacts only', async () => {
    const ownedContact = contact();
    const saved = letter({ contacts: [ownedContact] });
    letterService.insertDraftForMcp.mockResolvedValue(saved);
    letterService.findOwnedOneForMcp.mockResolvedValue({
      letter: saved,
      contactCount: 1,
      contactsTruncated: false,
    });

    await service.createLetterDraft(userUuid, {
      title: 'Hello',
      content: 'Stored body',
      contentFormat: 'markdown',
      inactiveAfterMinutes: 1440,
      contactUuids: [contactUuid],
    });

    expect(letterService.insertDraftForMcp).toHaveBeenCalledWith(userUuid, {
      title: 'Hello',
      content: 'Stored body',
      contentFormat: 'markdown',
      inactiveAfterMinutes: 1440,
      contactUuids: [contactUuid],
    });
  });

  it('rejects a draft that references a contact outside the current user scope', async () => {
    letterService.insertDraftForMcp.mockRejectedValue(new NotFoundException());

    await expect(
      service.createLetterDraft(userUuid, {
        title: 'Hello',
        content: 'Stored body',
        contentFormat: 'markdown',
        contactUuids: [contactUuid],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(letterService.insertDraftForMcp).toHaveBeenCalled();
  });

  it('refuses MCP updates to delivery-enabled letters', async () => {
    letterService.updateOwnedDraftForMcp.mockRejectedValue(new ConflictException());

    await expect(
      service.updateLetterDraft(userUuid, letterUuid, {
        expectedUpdatedAt: updatedAt.toISOString(),
        content: 'Changed body',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(letterService.updateOwnedDraftForMcp).toHaveBeenCalled();
  });

  it('rejects stale letter updates', async () => {
    letterService.updateOwnedDraftForMcp.mockRejectedValue(new ConflictException());

    await expect(
      service.updateLetterDraft(userUuid, letterUuid, {
        expectedUpdatedAt: new Date('2026-06-01T00:00:00.000Z').toISOString(),
        content: 'Changed body',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(letterService.updateOwnedDraftForMcp).toHaveBeenCalled();
  });

  it('passes draft updates to the atomic service operation', async () => {
    const updated = letter({ content: 'Changed body' });
    letterService.updateOwnedDraftForMcp.mockResolvedValue(updated);
    letterService.findOwnedOneForMcp.mockResolvedValue({
      letter: updated,
      contactCount: 0,
      contactsTruncated: false,
    });

    await service.updateLetterDraft(userUuid, letterUuid, {
      expectedUpdatedAt: updatedAt.toISOString(),
      content: 'Changed body',
      contactUuids: [contactUuid],
    });

    expect(letterService.updateOwnedDraftForMcp).toHaveBeenCalledWith(
      letterUuid,
      userUuid,
      updatedAt.toISOString(),
      {
        title: undefined,
        content: 'Changed body',
        contentFormat: undefined,
        inactiveAfterMinutes: undefined,
        contactUuids: [contactUuid],
      },
    );
  });

  it('returns a sanitized latest check-in status', async () => {
    const checkedAt = new Date('2026-07-03T00:00:00.000Z');
    checkInService.getStatus.mockResolvedValue({
      lastSeenAt: checkedAt,
      checkIn: {
        id: 42,
        uuid: '44444444-4444-4444-8444-444444444444',
        checkedAt,
        source: 'web',
        user: { uuid: userUuid, password: 'hidden' },
      },
    });

    await expect(service.getCheckInStatus(userUuid)).resolves.toEqual({
      lastSeenAt: checkedAt.toISOString(),
      checkIn: {
        uuid: '44444444-4444-4444-8444-444444444444',
        checkedAt: checkedAt.toISOString(),
        source: 'web',
      },
    });
  });
  it('does not disclose contact methods without the separate contact-read permission', async () => {
    letterService.findOwnedOneForMcp.mockResolvedValue({
      letter: letter({ contacts: [contact()] }),
      contactCount: 1,
      contactsTruncated: false,
    });
    const result = await service.getLetter(userUuid, letterUuid, false);
    expect(result.letter.contacts).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('alice@example.com');
    expect(JSON.stringify(result)).not.toContain('private note');
  });
});
