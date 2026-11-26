import { setupErrorCode, setupException } from './setup-error';
import { parseInput, usernameSchema, emailSchema } from 'src/validation';
import { setupPayloadSchema } from './setup.schema';
import { randomBytes } from 'crypto';
import webPush = require('web-push');
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  HttpException,
} from '@nestjs/common';
import {
  EnvMap,
  applyEnvUpdates,
  getEnvTemplate,
  getMissingEnvKeys,
  hasEnvFile,
  readEnvFile,
  requiredEnvKeys,
  setupEnvKeys,
  writeEnvFile,
  isRuntimeConfigured,
} from './env';
import { DatabaseSetupService } from './database-setup.service';
import { SetupInitialUser } from './setup.types';

export type SetupPayload = Partial<Record<(typeof setupEnvKeys)[number], string>> & {
  resetDatabase?: boolean;
  initialUser?: SetupInitialUser;
};

@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);
  private readonly readyAtStartup = isRuntimeConfigured();
  private setupAvailable = !this.readyAtStartup;
  private initializationInProgress = false;

  constructor(private readonly databaseSetupService: DatabaseSetupService) {}

  getStatus(): {
    needsSetup: boolean;
    requiresRestart: boolean;
    initializing: boolean;
    hasEnvFile?: boolean;
    requiredKeys?: readonly string[];
    missingKeys?: string[];
    databasePasswordConfigured?: boolean;
    values?: EnvMap;
  } {
    const state = {
      needsSetup: this.setupAvailable,
      requiresRestart: !this.readyAtStartup && !this.setupAvailable,
      initializing: this.initializationInProgress,
    };
    if (!this.setupAvailable) return state;
    const current = readEnvFile();
    const template = getEnvTemplate();
    const values = { ...template, ...current };
    const missingKeys = getMissingEnvKeys(current);

    return {
      ...state,
      hasEnvFile: hasEnvFile(),
      requiredKeys: requiredEnvKeys,
      missingKeys,
      databasePasswordConfigured: Boolean(current.DB_PASSWORD?.trim()),
      values: this.maskSensitiveValues(values),
    };
  }

  async initialize(payload: SetupPayload = {}) {
    return this.runWithSetupWriteLock(async () => {
      const safePayload = this.asSetupPayload(payload);
      const password = safePayload.INIT_ADMIN_PASSWORD;
      if (
        typeof password !== 'string' ||
        password.length < 8 ||
        password.length > 128 ||
        !password.trim() ||
        password.trim() === 'admin123456'
      ) {
        throw new BadRequestException(
          'A new administrator password of 8 to 128 characters is required.',
        );
      }
      const nextEnv = this.resolveEnv(safePayload);
      const initialUser = this.resolveInitialUser(safePayload.initialUser, nextEnv);
      const database = await this.databaseSetupService.initialize(nextEnv, {
        resetDatabase: safePayload.resetDatabase === true,
        initialUser,
      });
      const savedEnv = { ...nextEnv, INIT_ADMIN_PASSWORD: '' };
      writeEnvFile(savedEnv);
      applyEnvUpdates(savedEnv);
      this.setupAvailable = false;

      return {
        initialized: true,
        database,
        message: 'Configuration saved. Waiting for the server to restart.',
      };
    });
  }

  async checkDatabase(payload: SetupPayload = {}) {
    this.assertSetupAvailable();
    return this.databaseSetupService.check(this.resolveEnv(payload, false));
  }

  async initializeDatabase(payload: SetupPayload = {}) {
    return this.runWithSetupWriteLock(() => {
      const safePayload = this.asSetupPayload(payload);
      return this.databaseSetupService.initialize(this.resolveEnv(safePayload), {
        resetDatabase: safePayload.resetDatabase === true,
      });
    });
  }

  async migrateDatabase(payload: SetupPayload = {}) {
    return this.runWithSetupWriteLock(() =>
      this.databaseSetupService.migrate(this.resolveEnv(payload)),
    );
  }

  async seedDatabase(payload: SetupPayload = {}) {
    return this.runWithSetupWriteLock(async () => {
      const env = this.resolveEnv(payload);
      await this.databaseSetupService.seed(env);
      return this.databaseSetupService.check(env);
    });
  }

  async resetDatabase(payload: SetupPayload = {}) {
    return this.runWithSetupWriteLock(() =>
      this.databaseSetupService.reset(this.resolveEnv(payload)),
    );
  }

  private assertSetupAvailable(): void {
    if (!this.setupAvailable) {
      throw new ForbiddenException(
        'Setup operations are disabled after initialization; use the database CLI instead.',
      );
    }
  }

  private async runWithSetupWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    this.acquireSetupWriteLock();
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof HttpException))
        this.logger.error(`Setup failed: ${setupErrorCode(error) ?? 'UNKNOWN'}`);
      throw setupException(error);
    } finally {
      this.initializationInProgress = false;
    }
  }

  private acquireSetupWriteLock(): void {
    this.assertSetupAvailable();
    if (this.initializationInProgress) {
      throw new ConflictException('当前服务正在执行初始化操作，请等待完成后重试。');
    }
    this.initializationInProgress = true;
  }

  private resolveEnv(payload: unknown, requireAdmin = true): EnvMap {
    const safePayload = this.asSetupPayload(payload);
    const envPayload = Object.fromEntries(
      setupEnvKeys.flatMap((key) =>
        typeof safePayload[key] === 'string' ? [[key, safePayload[key]]] : [],
      ),
    ) as EnvMap;
    const defaults = {
      ...getEnvTemplate(),
      ...readEnvFile(),
    };
    // Reuse masked credentials only for the same connection. Never forward the saved
    // password to a caller-selected host or account when no new password was supplied.
    if (!envPayload.DB_PASSWORD?.trim()) {
      const sameConnection = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME'].every(
        (key) => envPayload[key] === undefined || envPayload[key].trim() === defaults[key]?.trim(),
      );
      envPayload.DB_PASSWORD = sameConnection ? defaults.DB_PASSWORD : '';
    }
    const env = this.normalizeEnv({
      ...defaults,
      ...envPayload,
    });
    const missingKeys = getMissingEnvKeys(env).filter(
      (key) => requireAdmin || !key.startsWith('INIT_ADMIN_'),
    );

    if (missingKeys.length > 0) {
      throw new BadRequestException(`Missing required env keys: ${missingKeys.join(', ')}`);
    }

    if (
      requireAdmin &&
      (env.INIT_ADMIN_PASSWORD === 'admin123456' ||
        env.INIT_ADMIN_PASSWORD.length < 8 ||
        env.INIT_ADMIN_PASSWORD.length > 128)
    ) {
      throw new BadRequestException(
        'Administrator password must be 8 to 128 characters and cannot use the former default.',
      );
    }
    if (requireAdmin) {
      env.INIT_ADMIN_USERNAME = parseInput(usernameSchema, env.INIT_ADMIN_USERNAME);
      env.INIT_ADMIN_EMAIL = parseInput(emailSchema, env.INIT_ADMIN_EMAIL);
    }
    for (const key of ['PORT', 'DB_PORT', 'MAIL_PORT']) {
      if (
        env[key] &&
        (!/^\d+$/.test(env[key]) || Number(env[key]) < 1 || Number(env[key]) > 65535)
      ) {
        throw new BadRequestException(`${key} must be a port between 1 and 65535.`);
      }
    }
    return env;
  }

  private asSetupPayload(payload: unknown): SetupPayload {
    return parseInput(setupPayloadSchema, payload) as SetupPayload;
  }

  private resolveInitialUser(
    initialUser: SetupInitialUser | undefined,
    env: EnvMap,
  ): SetupInitialUser {
    if (!initialUser) throw new BadRequestException('Initial user is required.');
    if (initialUser.email === env.INIT_ADMIN_EMAIL.trim().toLowerCase()) {
      throw new ConflictException('Initial user email must be different from the administrator.');
    }

    return initialUser;
  }

  private normalizeEnv(env: EnvMap): EnvMap {
    const normalized = { ...env };
    for (const key of setupEnvKeys) {
      normalized[key] = String(normalized[key] ?? '').trim();
    }

    if (!normalized.JWT_SECRET || normalized.JWT_SECRET === 'secret') {
      normalized.JWT_SECRET = randomBytes(32).toString('hex');
    }
    if (!normalized.WEB_PUSH_PUBLIC_KEY || !normalized.WEB_PUSH_PRIVATE_KEY) {
      const keys = webPush.generateVAPIDKeys();
      normalized.WEB_PUSH_PUBLIC_KEY = keys.publicKey;
      normalized.WEB_PUSH_PRIVATE_KEY = keys.privateKey;
    }

    return normalized;
  }

  private maskSensitiveValues(env: EnvMap): EnvMap {
    const sensitiveKeys = new Set([
      'DB_PASSWORD',
      'JWT_SECRET',
      'WEB_PUSH_PRIVATE_KEY',
      'WEB_PUSH_PROXY',
      'HTTPS_PROXY',
      'https_proxy',
      'MAIL_PASSWORD',
      'INIT_ADMIN_PASSWORD',
    ]);

    return Object.fromEntries(
      setupEnvKeys.map((key) => [key, sensitiveKeys.has(key) ? '' : env[key]]),
    );
  }
}
