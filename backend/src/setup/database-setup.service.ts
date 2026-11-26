import { setupException } from './setup-error';
import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createConnection } from 'mysql2/promise';
import { DataSource, EntityManager } from 'typeorm';
import { createHash } from 'crypto';
import { databaseEntities } from 'src/database/entities';
import { databaseMigrations } from 'src/database/migrations';
import { Permission } from 'src/permission/permission.entity';
import { Role } from 'src/role/role.entity';
import { User } from 'src/user/user.entity';
import { EnvMap } from './env';
import { hashPassword, verifyPassword } from 'src/auth/password';
import { SetupInitialUser } from './setup.types';

export type DatabaseCheckResult = {
  connected: boolean;
  databaseExists: boolean;
  schemaReady: boolean;
  missingTables: string[];
  pendingMigrations: boolean;
  seedStatus: {
    permissions: 'ready' | 'missing' | 'unchecked';
    roles: 'ready' | 'missing' | 'unchecked';
    adminUser: 'ready' | 'missing' | 'unchecked';
  };
  canInitialize: boolean;
  error?: string;
};

@Injectable()
export class DatabaseSetupService {
  async check(env: EnvMap): Promise<DatabaseCheckResult> {
    const baseResult: DatabaseCheckResult = {
      connected: false,
      databaseExists: false,
      schemaReady: false,
      missingTables: [],
      pendingMigrations: false,
      seedStatus: {
        permissions: 'unchecked',
        roles: 'unchecked',
        adminUser: 'unchecked',
      },
      canInitialize: false,
    };

    try {
      const databaseExists = await this.databaseExists(env);
      baseResult.connected = true;
      baseResult.databaseExists = databaseExists;
      baseResult.canInitialize = true;

      if (!databaseExists) {
        return baseResult;
      }

      const dataSource = await this.createDataSource(env);
      try {
        const missingTables = await this.getMissingTables(dataSource);
        const pendingMigrations = await dataSource.showMigrations();
        return {
          ...baseResult,
          missingTables,
          pendingMigrations,
          schemaReady: missingTables.length === 0 && !pendingMigrations,
          seedStatus:
            missingTables.length === 0 && !pendingMigrations
              ? await this.getSeedStatus(dataSource, env)
              : baseResult.seedStatus,
        };
      } finally {
        await dataSource.destroy();
      }
    } catch (error) {
      return {
        ...baseResult,
        error: setupException(error).message,
      };
    }
  }

  async initialize(
    env: EnvMap,
    options: { resetDatabase?: boolean; initialUser?: SetupInitialUser } = {},
  ): Promise<DatabaseCheckResult> {
    if (options.resetDatabase) {
      await this.dropDatabase(env);
    }

    await this.ensureDatabase(env);
    await this.migrate(env);
    await this.seed(env, options.initialUser);
    return this.check(env);
  }

  async migrate(env: EnvMap): Promise<DatabaseCheckResult> {
    const dataSource = await this.createDataSource(env);
    try {
      await dataSource.runMigrations();
    } finally {
      await dataSource.destroy();
    }
    return this.check(env);
  }

  async reset(env: EnvMap): Promise<DatabaseCheckResult> {
    return this.initialize(env, { resetDatabase: true });
  }

  async seed(env: EnvMap, initialUser?: SetupInitialUser): Promise<void> {
    const dataSource = await this.createDataSource(env);
    const runner = dataSource.createQueryRunner();
    const lockName = createHash('sha256').update(`after-life-owner:${env.DB_NAME}`).digest('hex');
    let locked = false;
    try {
      await runner.connect();
      // The connection-scoped lock also serializes independent installer/CLI processes.
      const rows: { acquired: number | string | null }[] = await runner.query(
        'SELECT GET_LOCK(?, 10) AS acquired',
        [lockName],
      );
      const acquired = rows[0]?.acquired;
      // TypeORM defaults to bigNumberStrings, so MySQL BIGINT results can be strings.
      if (acquired === 0 || acquired === '0') {
        throw new ConflictException('另一个初始化实例正在操作此数据库，请等待其完成后重试。');
      }
      if (acquired !== 1 && acquired !== '1') {
        throw new ServiceUnavailableException(
          '数据库无法取得初始化锁，请检查命名锁支持及连接状态后重试。',
        );
      }
      locked = true;
      await runner.startTransaction();
      await this.seedPermissionsAndRoles(runner.manager);
      await this.seedAdminUser(runner.manager, env);
      if (initialUser) await this.seedInitialUser(runner.manager, initialUser);
      await runner.commitTransaction();
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      try {
        if (locked) await runner.query('SELECT RELEASE_LOCK(?)', [lockName]);
      } finally {
        try {
          await runner.release();
        } finally {
          await dataSource.destroy();
        }
      }
    }
  }

  async ensureDatabase(env: EnvMap): Promise<void> {
    const connection = await createConnection({
      host: env.DB_HOST,
      port: Number(env.DB_PORT),
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      multipleStatements: false,
    });

    try {
      await connection.query(
        `CREATE DATABASE IF NOT EXISTS \`${this.escapeIdentifier(env.DB_NAME)}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
    } finally {
      await connection.end();
    }
  }

  private async dropDatabase(env: EnvMap): Promise<void> {
    const connection = await createConnection({
      host: env.DB_HOST,
      port: Number(env.DB_PORT),
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      multipleStatements: false,
    });

    try {
      await connection.query(`DROP DATABASE IF EXISTS \`${this.escapeIdentifier(env.DB_NAME)}\``);
    } finally {
      await connection.end();
    }
  }

  private async databaseExists(env: EnvMap): Promise<boolean> {
    const connection = await createConnection({
      host: env.DB_HOST,
      port: Number(env.DB_PORT),
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      multipleStatements: false,
    });

    try {
      const [rows] = await connection.query(
        'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
        [env.DB_NAME],
      );
      return Array.isArray(rows) && rows.length > 0;
    } finally {
      await connection.end();
    }
  }

  private async createDataSource(env: EnvMap): Promise<DataSource> {
    const dataSource = new DataSource({
      type: 'mysql',
      host: env.DB_HOST,
      port: Number(env.DB_PORT),
      username: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      synchronize: false,
      entities: databaseEntities,
      migrations: databaseMigrations,
      migrationsTableName: 'migrations',
    });

    await dataSource.initialize();
    return dataSource;
  }

  private async getMissingTables(dataSource: DataSource): Promise<string[]> {
    const queryRunner = dataSource.createQueryRunner();
    try {
      const missingTables: string[] = [];
      for (const metadata of dataSource.entityMetadatas) {
        const exists = await queryRunner.hasTable(metadata.tableName);
        if (!exists) {
          missingTables.push(metadata.tableName);
        }
      }
      return missingTables;
    } finally {
      await queryRunner.release();
    }
  }

  private async getSeedStatus(
    dataSource: DataSource,
    env: EnvMap,
  ): Promise<DatabaseCheckResult['seedStatus']> {
    const permissionRepository = dataSource.getRepository(Permission);
    const roleRepository = dataSource.getRepository(Role);
    const userRepository = dataSource.getRepository(User);

    const [permissions, roles, adminUser] = await Promise.all([
      permissionRepository.count({
        where: [
          { name: 'self', iSdelete: 0 },
          { name: 'admin', iSdelete: 0 },
        ],
      }),
      roleRepository.count({
        where: [
          { name: 'user', iSdelete: 0 },
          { name: 'admin', iSdelete: 0 },
        ],
      }),
      userRepository.count({
        where: { email: env.INIT_ADMIN_EMAIL, iSdelete: 0 },
      }),
    ]);

    return {
      permissions: permissions >= 2 ? 'ready' : 'missing',
      roles: roles >= 2 ? 'ready' : 'missing',
      adminUser: adminUser >= 1 ? 'ready' : 'missing',
    };
  }

  private escapeIdentifier(value: string): string {
    return value.replace(/`/g, '``');
  }

  private async seedPermissionsAndRoles(dataSource: EntityManager): Promise<void> {
    const permissionRepository = dataSource.getRepository(Permission);
    const roleRepository = dataSource.getRepository(Role);
    const permissionSeeds = [
      { name: 'self', description: 'Can only operate on owned resources' },
      { name: 'admin', description: 'Can manage privileged resources' },
    ];

    for (const seed of permissionSeeds) {
      const existing = await permissionRepository.findOne({
        where: { name: seed.name },
      });
      await permissionRepository.save(
        permissionRepository.create({
          ...existing,
          ...seed,
          iSdelete: 0,
        }),
      );
    }

    const permissions = await permissionRepository.find({
      where: permissionSeeds.map((seed) => ({ name: seed.name })),
    });
    const permissionMap = new Map(permissions.map((item) => [item.name, item]));
    const roleSeeds = [
      {
        name: 'admin',
        description: 'Administrator',
        permissions: ['admin', 'self'],
      },
      {
        name: 'user',
        description: 'Normal user',
        permissions: ['self'],
      },
    ];

    for (const seed of roleSeeds) {
      const existing = await roleRepository.findOne({
        where: { name: seed.name },
        relations: { permissions: true },
      });
      const role = roleRepository.create({
        ...existing,
        name: seed.name,
        description: seed.description,
        iSdelete: 0,
        permissions: seed.permissions
          .map((name) => permissionMap.get(name))
          .filter(Boolean) as Permission[],
      });
      await roleRepository.save(role);
    }
  }

  private async seedAdminUser(dataSource: EntityManager, env: EnvMap): Promise<void> {
    const userRepository = dataSource.getRepository(User);
    const roleRepository = dataSource.getRepository(Role);
    const adminRole = await roleRepository.findOne({
      where: { name: 'admin', iSdelete: 0 },
      relations: { permissions: true },
    });

    if (!adminRole) {
      throw new Error('admin role was not created');
    }

    const password = await hashPassword(env.INIT_ADMIN_PASSWORD);
    const existing = await userRepository.findOne({
      where: { email: env.INIT_ADMIN_EMAIL },
      relations: { role: true },
    });

    await userRepository.save(
      userRepository.create({
        ...existing,
        username: env.INIT_ADMIN_USERNAME,
        email: env.INIT_ADMIN_EMAIL,
        password,
        role: adminRole,
        iSdelete: 0,
      }),
    );
  }

  private async seedInitialUser(
    dataSource: EntityManager,
    initialUser: SetupInitialUser,
  ): Promise<void> {
    const userRepository = dataSource.getRepository(User);
    const roleRepository = dataSource.getRepository(Role);
    const existing = await userRepository.findOne({
      where: { email: initialUser.email },
      relations: { role: true },
      select: {
        id: true,
        uuid: true,
        username: true,
        email: true,
        password: true,
        iSdelete: true,
      },
    });

    if (existing) {
      const isSameUser =
        existing.iSdelete === 0 &&
        existing.username === initialUser.username &&
        existing.role?.name === 'user' &&
        existing.role.iSdelete === 0 &&
        typeof existing.password === 'string' &&
        (await verifyPassword(initialUser.password, existing.password));
      if (isSameUser) return;
      throw new ConflictException('Initial user email already exists.');
    }

    const userRole = await roleRepository.findOne({
      where: { name: 'user', iSdelete: 0 },
      relations: { permissions: true },
    });
    if (!userRole) {
      throw new Error('user role was not created');
    }

    const password = await hashPassword(initialUser.password);
    try {
      await userRepository.save(
        userRepository.create({
          username: initialUser.username,
          email: initialUser.email,
          password,
          role: userRole,
          iSdelete: 0,
        }),
      );
    } catch (error) {
      if (this.isDuplicateEntry(error)) {
        throw new ConflictException('Initial user email already exists.');
      }
      throw error;
    }
  }

  private isDuplicateEntry(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const databaseError = error as {
      code?: unknown;
      errno?: unknown;
      driverError?: { code?: unknown; errno?: unknown };
    };
    return (
      databaseError.code === 'ER_DUP_ENTRY' ||
      databaseError.errno === 1062 ||
      databaseError.driverError?.code === 'ER_DUP_ENTRY' ||
      databaseError.driverError?.errno === 1062
    );
  }
}
