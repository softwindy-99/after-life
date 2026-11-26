import { ConflictException, NotFoundException } from '@nestjs/common';
import { McpSettingsService } from './mcp-settings.service';
import { Auth } from 'src/auth/auth.entity';
import { Letter } from 'src/letter/letter.entity';
import { User } from 'src/user/user.entity';
import { createMockRepository } from 'src/test-utils/mock-repository';

describe('McpSettingsService', () => {
  let auths: ReturnType<typeof createMockRepository>;
  let events: ReturnType<typeof createMockRepository>;
  let letters: ReturnType<typeof createMockRepository>;
  let service: McpSettingsService;
  beforeEach(() => {
    auths = createMockRepository();
    events = createMockRepository();
    letters = createMockRepository();
    const users = createMockRepository();
    users.findOne.mockResolvedValue({ id: 1, uuid: 'owner' });
    Object.assign(events, {
      manager: {
        transaction: (
          work: (manager: { getRepository: (entity: unknown) => typeof auths }) => Promise<unknown>,
        ) =>
          work({
            getRepository: (entity) =>
              entity === User
                ? users
                : entity === Auth
                  ? auths
                  : entity === Letter
                    ? letters
                    : events,
          }),
      },
    });
    service = new McpSettingsService(auths as any, events as any, {} as any, {} as any, {} as any);
  });
  it('cannot alter a grant owned by another user', async () => {
    auths.findOne.mockResolvedValue(null);
    await expect(
      service.update('owner', 'foreign-grant', { name: 'Mine', scopes: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(auths.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ uuid: 'foreign-grant', user: { uuid: 'owner' } }),
      }),
    );
    expect(auths.update).not.toHaveBeenCalled();
  });
  it('never silently upgrades legacy credentials', async () => {
    auths.findOne.mockResolvedValue({ id: 1, mcpScopes: null });
    await expect(
      service.update('owner', 'legacy', { name: 'Mine', scopes: ['mcp:delivery:write'] }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(auths.update).not.toHaveBeenCalled();
  });
  it('expires outstanding proposals when the human changes permissions', async () => {
    auths.findOne.mockResolvedValue({ id: 1, mcpScopes: ['mcp:read'] });
    await service.update('owner', 'grant', { name: 'Mine', scopes: [] });
    expect(events.update).toHaveBeenCalledWith(
      { authUuid: 'grant', outcome: 'approved' },
      { outcome: 'expired' },
    );
    expect(events.update).toHaveBeenCalledWith(
      { authUuid: 'grant', outcome: 'ready' },
      { outcome: 'expired' },
    );
  });
  it('lists pending requests for permanent and unexpired grants only', async () => {
    const grants = [
      { uuid: 'permanent', mcpExpiresAt: null, mcpScopes: ['mcp:delivery:write'] },
      {
        uuid: 'active',
        mcpExpiresAt: new Date(Date.now() + 60000),
        mcpScopes: ['mcp:delivery:write'],
      },
      { uuid: 'expired', mcpExpiresAt: new Date(0), mcpScopes: ['mcp:delivery:write'] },
    ];
    auths.find.mockResolvedValue(grants);
    events.findAndCount.mockResolvedValue([[], 0]);
    events.find.mockResolvedValue([
      ...[...grants.map((grant) => grant.uuid), 'revoked'].map((authUuid) => ({
        uuid: authUuid,
        authUuid,
        expiresAt: new Date(Date.now() + 60000),
      })),
      { uuid: 'expired-preview', authUuid: 'permanent', expiresAt: new Date(0) },
    ]);
    Object.assign(events, { manager: { getRepository: () => events } });
    events.findOne.mockResolvedValue(null);

    const result = (await service.getSettings('owner')) as {
      grants: { uuid: string; expiresAt: Date | null; legacy: boolean }[];
      pending: { uuid: string }[];
    };
    expect(result.grants[0]).toMatchObject({ uuid: 'permanent', expiresAt: null, legacy: false });
    expect(result.pending.map((event) => event.uuid)).toEqual(['permanent', 'active']);
  });
  it('refuses expired, foreign, changed or revoked approval requests', async () => {
    events.findOne.mockResolvedValue(null);
    await expect(service.approve('owner', 'foreign', true)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const event = {
      authUuid: 'grant',
      resourceUuid: 'letter',
      expiresAt: new Date(Date.now() + 60000),
      details: { expectedUpdatedAt: '2026-10-19T01:00:00.000Z' },
      outcome: 'pending',
    };
    events.findOne.mockResolvedValue(event);
    auths.findOne.mockResolvedValue({
      mcpScopes: ['mcp:delivery:write'],
      mcpExpiresAt: new Date(Date.now() + 60000),
    });
    letters.findOne.mockResolvedValue({ updatedAt: new Date('2026-10-19T02:00:00Z') });
    await expect(service.approve('owner', 'changed', true)).rejects.toBeInstanceOf(
      ConflictException,
    );
    auths.findOne.mockResolvedValue(null);
    await expect(service.approve('owner', 'revoked', true)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(events.save).not.toHaveBeenCalled();
  });
  it.each([null, new Date(Date.now() + 60000)])(
    'approves the exact current version for grant expiry %s through the human path',
    async (expiresAt) => {
      const updatedAt = new Date();
      const event = {
        authUuid: 'grant',
        resourceUuid: 'letter',
        expiresAt: new Date(Date.now() + 60000),
        details: { expectedUpdatedAt: updatedAt.toISOString() },
        outcome: 'pending',
      };
      events.findOne.mockResolvedValue(event);
      auths.findOne.mockResolvedValue({
        mcpScopes: ['mcp:delivery:write'],
        mcpExpiresAt: expiresAt,
      });
      letters.findOne.mockResolvedValue({ updatedAt });
      await service.approve('owner', 'request', true);
      expect(event.outcome).toBe('approved');
      expect(events.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ user: { uuid: 'owner' }, outcome: 'pending' }),
        }),
      );
    },
  );
});
