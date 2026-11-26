import { BadRequestException, Injectable } from '@nestjs/common';
import { RuntimeConfigWriter } from 'src/setup/runtime-config.writer';
import {
  PushProxySource,
  SystemSettingsStatus,
  UpdateSystemSettings,
} from './system-settings.types';

@Injectable()
export class SystemSettingsService {
  constructor(private readonly configWriter: RuntimeConfigWriter) {}

  getSettings(): SystemSettingsStatus {
    const { proxy, source } = this.resolvePushProxy();
    const parsed = this.parseProxy(proxy);

    return {
      pushProxy: parsed ? this.toDisplayUrl(parsed) : '',
      pushProxyConfigured: Boolean(proxy),
      pushProxyValid: Boolean(parsed),
      pushProxyHasCredentials: Boolean(parsed?.username || parsed?.password),
      pushProxySource: source,
    };
  }

  async updateSettings(payload: UpdateSystemSettings): Promise<SystemSettingsStatus> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException('settings payload must be an object');
    }

    if (payload.pushProxy !== undefined && payload.pushProxy !== null) {
      const pushProxy = this.normalizeProxy(payload.pushProxy);
      const env = { WEB_PUSH_PROXY: pushProxy };
      await this.configWriter.update(env);
    }

    return this.getSettings();
  }

  private resolvePushProxy(): { proxy: string; source: PushProxySource } {
    const candidates: Array<[PushProxySource, string | undefined]> = [
      ['WEB_PUSH_PROXY', process.env.WEB_PUSH_PROXY],
      ['HTTPS_PROXY', process.env.HTTPS_PROXY],
      ['https_proxy', process.env.https_proxy],
    ];
    const match = candidates.find(([, value]) => Boolean(value?.trim()));
    return match
      ? { proxy: match[1]?.trim() || '', source: match[0] }
      : { proxy: '', source: null };
  }

  private normalizeProxy(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('pushProxy must be a string or null');
    }

    const normalized = value.trim();
    if (!normalized) return '';
    if (normalized.length > 2048 || /[\r\n]/.test(normalized)) {
      throw new BadRequestException('pushProxy must be a valid HTTP or HTTPS proxy URL');
    }

    const parsed = this.parseProxy(normalized);
    if (!parsed || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new BadRequestException('pushProxy must be a valid HTTP or HTTPS proxy URL');
    }
    return this.trimRootSlash(parsed.toString());
  }

  private parseProxy(value: string): URL | null {
    if (!value) return null;
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol) &&
        parsed.hostname &&
        parsed.pathname === '/' &&
        !parsed.search &&
        !parsed.hash
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  private toDisplayUrl(proxy: URL): string {
    const display = new URL(proxy.toString());
    display.username = '';
    display.password = '';
    return this.trimRootSlash(display.toString());
  }

  private trimRootSlash(value: string): string {
    return value.endsWith('/') ? value.slice(0, -1) : value;
  }
}
