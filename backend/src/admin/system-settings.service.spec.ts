import { BadRequestException } from '@nestjs/common';
import * as setupEnv from 'src/setup/env';
import { SystemSettingsService } from './system-settings.service';
import { RuntimeConfigWriter } from 'src/setup/runtime-config.writer';

describe('SystemSettingsService', () => {
  let service: SystemSettingsService;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
    delete process.env.WEB_PUSH_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    service = new SystemSettingsService(new RuntimeConfigWriter());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = originalEnv;
  });

  it('returns a sanitized effective proxy without credentials', () => {
    process.env.WEB_PUSH_PROXY = 'http://proxy-user:proxy-password@127.0.0.1:7890';

    expect(service.getSettings()).toEqual({
      pushProxy: 'http://127.0.0.1:7890',
      pushProxyConfigured: true,
      pushProxyValid: true,
      pushProxyHasCredentials: true,
      pushProxySource: 'WEB_PUSH_PROXY',
    });
  });

  it('reports a standard HTTPS proxy fallback', () => {
    process.env.HTTPS_PROXY = 'http://proxy.example:8080';

    expect(service.getSettings()).toMatchObject({
      pushProxy: 'http://proxy.example:8080',
      pushProxyConfigured: true,
      pushProxyValid: true,
      pushProxySource: 'HTTPS_PROXY',
    });
  });

  it('writes and applies a normalized Web Push proxy', async () => {
    const writeEnvFile = jest.spyOn(setupEnv, 'writeEnvFile').mockImplementation();
    const applyEnvUpdates = jest
      .spyOn(setupEnv, 'applyEnvUpdates')
      .mockImplementation((env) => Object.assign(process.env, env));

    await expect(
      service.updateSettings({ pushProxy: ' http://127.0.0.1:7890/ ' }),
    ).resolves.toMatchObject({
      pushProxy: 'http://127.0.0.1:7890',
      pushProxyConfigured: true,
      pushProxySource: 'WEB_PUSH_PROXY',
    });
    expect(writeEnvFile).toHaveBeenCalledWith({
      WEB_PUSH_PROXY: 'http://127.0.0.1:7890',
    });
    expect(applyEnvUpdates).toHaveBeenCalledWith({
      WEB_PUSH_PROXY: 'http://127.0.0.1:7890',
    });
  });

  it('clears the saved Web Push proxy when an empty value is submitted', async () => {
    process.env.WEB_PUSH_PROXY = 'http://127.0.0.1:7890';
    const writeEnvFile = jest.spyOn(setupEnv, 'writeEnvFile').mockImplementation();
    jest.spyOn(setupEnv, 'applyEnvUpdates').mockImplementation((env) => {
      Object.assign(process.env, env);
    });

    await expect(service.updateSettings({ pushProxy: ' ' })).resolves.toMatchObject({
      pushProxy: '',
      pushProxyConfigured: false,
      pushProxySource: null,
    });
    expect(writeEnvFile).toHaveBeenCalledWith({ WEB_PUSH_PROXY: '' });
  });

  it('preserves settings when the proxy field is null', async () => {
    process.env.WEB_PUSH_PROXY = 'http://127.0.0.1:7890';
    const writeEnvFile = jest.spyOn(setupEnv, 'writeEnvFile').mockImplementation();
    const applyEnvUpdates = jest.spyOn(setupEnv, 'applyEnvUpdates').mockImplementation();

    await expect(service.updateSettings({ pushProxy: null })).resolves.toMatchObject({
      pushProxy: 'http://127.0.0.1:7890',
    });
    expect(writeEnvFile).not.toHaveBeenCalled();
    expect(applyEnvUpdates).not.toHaveBeenCalled();
  });

  it.each([
    'socks5://127.0.0.1:1080',
    'http://127.0.0.1:7890/path',
    'http://127.0.0.1:7890?token=value',
    'not-a-url',
  ])('rejects an invalid proxy URL without writing it: %s', async (pushProxy) => {
    const writeEnvFile = jest.spyOn(setupEnv, 'writeEnvFile').mockImplementation();

    await expect(service.updateSettings({ pushProxy })).rejects.toThrow(BadRequestException);
    expect(writeEnvFile).not.toHaveBeenCalled();
  });
});
