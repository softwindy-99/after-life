import * as setupEnv from './env';
import { resolveRuntimeConfig } from './runtime-config';
import { RuntimeConfigWriter } from './runtime-config.writer';

describe('runtime configuration updates', () => {
  const originalEnv = process.env;
  const writer = new RuntimeConfigWriter();

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.spyOn(setupEnv, 'writeEnvFile').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('persists settings to the env file and applies them immediately', async () => {
    await writer.update({ MAIL_HOST: 'smtp.example.com' });
    expect(setupEnv.writeEnvFile).toHaveBeenCalledWith({ MAIL_HOST: 'smtp.example.com' });
    expect(process.env.MAIL_HOST).toBe('smtp.example.com');
  });

  it('saves file changes over conflicting launch variables now and on reload', async () => {
    const launch = { MAIL_HOST: 'docker-smtp', MAIL_FROM: '' };
    Object.assign(process.env, launch);
    const changes = { MAIL_HOST: 'file-smtp', MAIL_FROM: 'file@example.com', MAIL_PORT: '587' };
    await writer.update(changes);
    expect(setupEnv.writeEnvFile).toHaveBeenCalledWith(changes);
    expect(process.env.MAIL_HOST).toBe('file-smtp');
    expect(process.env.MAIL_FROM).toBe('file@example.com');
    expect(process.env.MAIL_PORT).toBe('587');
    expect(resolveRuntimeConfig(changes).values).toEqual(changes);
  });

  it('does not apply changes when persistence fails', async () => {
    process.env.MAIL_HOST = 'original';
    jest.mocked(setupEnv.writeEnvFile).mockImplementation(() => {
      throw new Error('read-only file');
    });
    await expect(writer.update({ MAIL_HOST: 'new' })).rejects.toThrow('read-only file');
    expect(process.env.MAIL_HOST).toBe('original');
  });
});
