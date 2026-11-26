import { resolveRuntimeConfig } from './runtime-config';

describe('runtime configuration selection', () => {
  const external = {
    DB_HOST: 'localhost',
    DB_PORT: '3306',
    DB_USER: 'test',
    DB_PASSWORD: 'test-password',
    DB_NAME: 'after_life_test',
    JWT_SECRET: 'external-secret',
  };

  it('uses only file values to decide whether installation is complete', () => {
    const original = process.env;
    process.env = { ...original, ...external, JWT_SECRET: 'ambient' };
    try {
      expect(resolveRuntimeConfig({})).toEqual({ ready: false, values: {} });
      expect(resolveRuntimeConfig(external)).toEqual({ ready: true, values: external });
      expect(resolveRuntimeConfig({ ...external, JWT_SECRET: '' }).ready).toBe(false);
    } finally {
      process.env = original;
    }
  });
});
