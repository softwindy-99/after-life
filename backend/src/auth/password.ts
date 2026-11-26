import { createHash, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);
const SCRYPT_PREFIX = 'scrypt';
const SCRYPT_KEY_LENGTH = 64;
const LEGACY_SHA256_PATTERN = /^[a-f\d]{64}$/i;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  return `${SCRYPT_PREFIX}$${salt}$${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, encodedPassword: string): Promise<boolean> {
  if (isLegacyPasswordHash(encodedPassword)) {
    const candidate = createHash('sha256').update(password).digest();
    const expected = Buffer.from(encodedPassword, 'hex');
    return timingSafeEqual(candidate, expected);
  }

  const [prefix, salt, encodedKey] = encodedPassword.split('$');
  if (prefix !== SCRYPT_PREFIX || !salt || !encodedKey) return false;

  try {
    const candidate = (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
    const expected = Buffer.from(encodedKey, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function isLegacyPasswordHash(encodedPassword: string): boolean {
  return LEGACY_SHA256_PATTERN.test(encodedPassword);
}
