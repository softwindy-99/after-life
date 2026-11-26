import { ConflictException, ForbiddenException } from '@nestjs/common';
import { McpActionsService } from './mcp-actions.service';
import { McpActivity } from './mcp-activity.entity';
import { CheckIn } from 'src/check-in/check-in.entity';
import { User } from 'src/user/user.entity';
import { createMockRepository } from 'src/test-utils/mock-repository';
import { McpPrincipal } from './mcp.types';

describe('McpActionsService', () => {
  const principal: McpPrincipal = {
    uuid: 'owner',
    authUuid: 'grant',
    mcpManaged: true,
    permissions: ['self'],
    mcpScopes: ['mcp:read', 'mcp:letters:write', 'mcp:delivery:write'],
  };
  const updatedAt = new Date('2026-10-19T01:00:00Z');
  let letters: Record<string, jest.Mock>;
  let activities: ReturnType<typeof createMockRepository>;
  let auths: ReturnType<typeof createMockRepository>;
  let resources: Record<string, jest.Mock>;
  let jwt: Record<string, jest.Mock>;
  let service: McpActionsService;
  beforeEach(() => {
    letters = { findOwnedOne: jest.fn(), updateOwned: jest.fn(), insert: jest.fn() };
    activities = createMockRepository();
    auths = createMockRepository();
    resources = { upload: jest.fn() };
    jwt = { verifyAsync: jest.fn(), signAsync: jest.fn() };
    service = new McpActionsService(
      letters as any,
      resources as any,
      {} as any,
      jwt as any,
      activities as any,
      auths as any,
    );
  });

  function commitFixture(outcome: string, minutes: number, lastSeen = new Date()) {
    const current = { uuid: 'letter', updatedAt, inactiveAfterMinutes: 1, deliveryEnabled: false };
    const preview = {
      outcome,
      resourceUuid: 'letter',
      authUuid: 'grant',
      expiresAt: new Date(Date.now() + 60000),
      details: { expectedUpdatedAt: updatedAt.toISOString(), inactiveAfterMinutes: minutes },
    };
    activities.findOne.mockResolvedValue(preview);
    const manager = {
      getRepository: (entity: unknown) =>
        entity === McpActivity
          ? activities
          : entity === CheckIn
            ? { findOne: async () => ({ checkedAt: lastSeen }) }
            : entity === User
              ? { findOne: async () => ({ createdAt: lastSeen }) }
              : undefined,
    };
    letters.updateOwned.mockImplementation(async (_letter, _user, patch, policy) => {
      await policy.beforeWrite(manager, current);
      return { ...current, ...patch };
    });
    return { current, preview };
  }

  it('refuses an overdue preview until a human has approved it', async () => {
    commitFixture('pending', 60, new Date(Date.now() - 86400000));
    await expect(
      service.setDelivery(principal, 'letter', updatedAt.toISOString(), true, 'preview'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(activities.save).not.toHaveBeenCalled();
  });
  it('consumes an approved overdue preview in the same letter write', async () => {
    const { current, preview } = commitFixture('approved', 60, new Date(Date.now() - 86400000));
    await expect(
      service.setDelivery(principal, 'letter', updatedAt.toISOString(), true, 'preview'),
    ).resolves.toMatchObject({ deliveryEnabled: true, inactiveAfterMinutes: 60 });
    expect(current.inactiveAfterMinutes).toBe(60);
    expect(preview.outcome).toBe('consumed');
    await expect(
      service.setDelivery(principal, 'letter', updatedAt.toISOString(), true, 'preview'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('refuses a previously future preview that becomes overdue before commit', async () => {
    commitFixture('ready', 60, new Date(Date.now() - 86400000));
    await expect(
      service.setDelivery(principal, 'letter', updatedAt.toISOString(), true, 'preview'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('refuses approvals for an old letter version', async () => {
    const { preview } = commitFixture('approved', 60);
    preview.details.expectedUpdatedAt = '2020-01-01T00:00:00.000Z';
    await expect(
      service.setDelivery(principal, 'letter', updatedAt.toISOString(), true, 'preview'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('allows disabling without any preview', async () => {
    commitFixture('pending', 60);
    await expect(
      service.setDelivery(principal, 'letter', updatedAt.toISOString(), false),
    ).resolves.toMatchObject({ deliveryEnabled: false });
    expect(activities.findOne).not.toHaveBeenCalled();
  });
  it('invalidates uploads as soon as the grant loses upload permission', async () => {
    jwt.verifyAsync.mockResolvedValue({ userUuid: 'owner', authUuid: 'grant', sizeBytes: 1 });
    auths.findOne.mockResolvedValue({
      mcpScopes: ['mcp:read'],
      mcpExpiresAt: new Date(Date.now() + 60000),
    });
    await expect(
      service.upload('ticket', {
        buffer: Buffer.from('x'),
        size: 1,
        mimetype: 'text/plain',
        originalname: 'file',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(resources.upload).not.toHaveBeenCalled();
  });
  it.each([null, new Date(Date.now() + 60000)])(
    'uses a single-use upload claim for grant expiry %s and only safe metadata',
    async (expiresAt) => {
      jwt.verifyAsync.mockResolvedValue({
        userUuid: 'owner',
        authUuid: 'grant',
        eventUuid: 'upload',
        sizeBytes: 1,
        filename: 'safe.txt',
        mimeType: 'text/plain',
      });
      auths.findOne.mockResolvedValue({
        uuid: 'grant',
        user: { role: { iSdelete: 0, permissions: [{ name: 'self', iSdelete: 0 }] } },
        mcpScopes: ['mcp:resources:write'],
        mcpExpiresAt: expiresAt,
      });
      activities.findOne.mockResolvedValue({ uuid: 'upload' });
      activities.update
        .mockResolvedValueOnce({ affected: 1 })
        .mockResolvedValueOnce({ affected: 0 });
      resources.upload.mockResolvedValue({ uuid: 'resource' });
      const file = {
        buffer: Buffer.from('x'),
        size: 1,
        mimetype: 'text/html',
        originalname: '../other',
      };
      await service.upload('ticket', file);
      expect(resources.upload).toHaveBeenCalledWith(
        'owner',
        expect.objectContaining({ originalname: 'safe.txt', mimetype: 'text/plain' }),
      );
      await expect(service.upload('ticket', file)).rejects.toBeInstanceOf(ConflictException);
      expect(resources.upload).toHaveBeenCalledTimes(1);
    },
  );
});
