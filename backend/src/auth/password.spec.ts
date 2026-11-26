import { createHash } from 'crypto';
import { hashPassword, isLegacyPasswordHash, verifyPassword } from './password';

describe('password helpers', () => {
  it('creates salted scrypt hashes and verifies them', async () => {
    const first = await hashPassword('secret');
    const second = await hashPassword('secret');

    expect(first).toMatch(/^scrypt\$[a-f\d]+\$[a-f\d]+$/);
    expect(second).not.toBe(first);
    await expect(verifyPassword('secret', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong', first)).resolves.toBe(false);
  });

  it('supports legacy SHA-256 hashes during migration', async () => {
    const legacy = createHash('sha256').update('secret').digest('hex');

    expect(isLegacyPasswordHash(legacy)).toBe(true);
    await expect(verifyPassword('secret', legacy)).resolves.toBe(true);
    await expect(verifyPassword('wrong', legacy)).resolves.toBe(false);
  });

  it('rejects malformed hashes', async () => {
    await expect(verifyPassword('secret', 'invalid')).resolves.toBe(false);
    await expect(verifyPassword('secret', 'scrypt$missing-key')).resolves.toBe(false);
  });
});
