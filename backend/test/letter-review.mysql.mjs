import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { DataSource } from 'typeorm';

const require = createRequire(import.meta.url);
const { databaseEntities } = require('../dist/database/entities');
const { databaseMigrations } = require('../dist/database/migrations');
const {
  ResourceStorage1740000000000,
} = require('../dist/database/migrations/1740000000000-ResourceStorage');
const { readEnvFile } = require('../dist/setup/env');
const { hashPassword } = require('../dist/auth/password');
const { User } = require('../dist/user/user.entity');
const { Role } = require('../dist/role/role.entity');
const { Contact } = require('../dist/contact/contact.entity');
const { Letter } = require('../dist/letter/letter.entity');
const { CheckIn } = require('../dist/check-in/check-in.entity');
const { CheckInService } = require('../dist/check-in/check-in.service');
const { Resource } = require('../dist/resource/resource.entity');
const { ContactService } = require('../dist/contact/contact.service');
const { LetterService } = require('../dist/letter/letter.service');
const { ResourceService } = require('../dist/resource/resource.service');
const { ResourceStorageService } = require('../dist/resource/resource-storage.service');
const { lockOwnedUser } = require('../dist/correspondence/transaction');

async function verify() {
  const env = readEnvFile();
  const connection = {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
  };
  // 只创建并销毁本次测试独有的随机数据库，永不使用配置中的 DB_NAME。
  // Create and drop only this run's random schema; never use the configured DB_NAME.
  const database = `after_life_test_${randomBytes(8).toString('hex')}`;
  const admin = await mysql.createConnection(connection);
  let source;
  const resources = await mkdtemp(join(tmpdir(), 'after-life-mysql-'));
  try {
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    source = new DataSource({
      type: 'mysql',
      ...connection,
      username: connection.user,
      database,
      entities: databaseEntities,
      migrations: databaseMigrations,
      synchronize: false,
      logging: false,
    });
    await source.initialize();
    await source.runMigrations();
    assert.deepEqual(
      await source.query("SHOW TABLES LIKE 'runtime_configuration'"),
      [],
      'fresh installations must not retain the retired configuration table',
    );
    Object.assign(process.env, {
      JWT_SECRET: randomBytes(32).toString('hex'),
      RESOURCE_STORAGE_DRIVER: 'local',
      RESOURCE_STORAGE_DIR: resources,
      RESOURCE_STORAGE_ENDPOINT: '',
      PUBLIC_BASE_URL: 'https://letters.example.test/api',
      DELIVERED_LETTER_RETENTION_DAYS: '30',
    });
    const users = source.getRepository(User);
    const contacts = source.getRepository(Contact);
    const letters = source.getRepository(Letter);
    const files = source.getRepository(Resource);
    const checkIns = source.getRepository(CheckIn);
    const role = await source
      .getRepository(Role)
      .save({ name: 'admin', description: 'Test owner' });
    const owner = await users.save({
      username: 'Review test',
      email: 'owner@example.test',
      password: await hashPassword(randomBytes(24).toString('hex')),
      role,
    });
    const storage = new ResourceStorageService(files, {
      update: () => {
        throw new Error('Configuration writes are forbidden in this test');
      },
    });
    const resourceService = new ResourceService(files, users, storage);
    const service = new LetterService(letters, contacts, resourceService, {
      isConfigured: () => true,
    });
    const contactService = new ContactService(contacts, letters);
    const contact = await contactService.insert({
      name: 'Family',
      email: 'family@example.test',
      user: owner,
    });
    const draft = await service.insert({
      title: 'Review me',
      content: '<p>Original</p>',
      contentFormat: 'html',
      contacts: [contact],
      user: owner,
    });
    const input = {
      title: draft.title,
      content: draft.content,
      contentFormat: 'html',
      letterUuid: draft.uuid,
      expectedUpdatedAt: draft.updatedAt.toISOString(),
      contactUuids: [contact.uuid],
      inactiveAfterMinutes: 1440,
      deliveryEnabled: true,
    };
    const apply = (review, content = input.content) =>
      service.updateOwned(
        draft.uuid,
        owner.uuid,
        {
          title: input.title,
          content,
          deliveryEnabled: true,
          inactiveAfterMinutes: 1440,
          contacts: [contact],
        },
        undefined,
        input.expectedUpdatedAt,
        { token: review.token },
      );

    const checkInService = new CheckInService(checkIns, users);
    const status = await checkInService.getStatus(owner.uuid);
    assert.equal(status.lastSeenAt, null);
    assert.equal(status.baselineAt.toISOString(), owner.createdAt.toISOString());
    const review = await service.previewDelivery(owner.uuid, input);
    assert.equal(review.baselineSource, 'account-created');
    assert.equal(review.baselineAt, owner.createdAt.toISOString());
    assert.equal((await letters.findOneByOrFail({ uuid: draft.uuid })).deliveryEnabled, false);
    assert.equal(await checkIns.count(), 0);

    await contactService.updateOwned(contact.uuid, owner.uuid, {
      email: 'new-family@example.test',
    });
    // 联系人变化会推进信件版本，旧摘要和旧表单均不得覆盖新关系。
    // Recipient edits advance the letter version, invalidating both old forms and reviews.
    await assert.rejects(apply(review), { status: 409 });
    let current = await letters.findOneByOrFail({ uuid: draft.uuid });
    input.expectedUpdatedAt = current.updatedAt.toISOString();
    const fresh = await service.previewDelivery(owner.uuid, input);
    assert.equal(fresh.recipients[0].email, 'new-family@example.test');

    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await lockOwnedUser(runner.manager.getRepository(User), owner.uuid);
      let settled = false;
      const waiting = apply(fresh).then(
        () => {
          settled = true;
          return null;
        },
        (error) => {
          settled = true;
          return error;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(settled, false, 'A reviewed write must wait for the user lock');
      await runner.manager
        .getRepository(CheckIn)
        .save({ user: owner, checkedAt: new Date(Date.now() + 1000), source: 'mysql-test' });
      await runner.commitTransaction();
      assert.equal(
        (await waiting)?.status,
        409,
        'The write must reread the check-in after acquiring the lock',
      );
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    assert.equal((await letters.findOneByOrFail({ uuid: draft.uuid })).deliveryEnabled, false);

    const body = Buffer.from('private attachment');
    const uploaded = await resourceService.upload(owner.uuid, {
      originalname: 'note.txt',
      mimetype: 'text/plain',
      buffer: body,
      size: body.length,
    });
    const migrationRunner = source.createQueryRunner();
    await migrationRunner.connect();
    try {
      await migrationRunner.dropColumns('resource', ['storageTarget', 'storageDriver']);
      await new ResourceStorage1740000000000().up(migrationRunner);
      await new ResourceStorage1740000000000().up(migrationRunner);
      assert.equal(
        (await files.findOneByOrFail({ uuid: uploaded.uuid })).storageDriver,
        'local',
        'Old resources must retain their default local location',
      );
    } finally {
      await migrationRunner.release();
    }
    input.content = `<p>With attachment <a href="/resource/${uploaded.uuid}">note.txt</a></p>`;
    const withFile = await service.previewDelivery(owner.uuid, input);
    assert.equal(withFile.resourceCount, 1);
    assert.equal(withFile.baselineSource, 'check-in');
    const unclaimed = await files.findOneOrFail({
      where: { uuid: uploaded.uuid },
      relations: { letter: true },
    });
    assert.equal(unclaimed.letter, null, 'A review must not claim temporary uploads');
    await apply(withFile, input.content);
    current = await letters.findOneByOrFail({ uuid: draft.uuid });
    assert.equal(current.deliveryEnabled, true);
    assert.equal(current.resourceCount, 1);
    const claimed = await files.findOneOrFail({
      where: { uuid: uploaded.uuid },
      relations: { letter: true },
    });
    assert.equal(claimed.letter.uuid, draft.uuid);
    const newInput = {
      title: 'New enabled letter',
      content: '<p>Reviewed before creation</p>',
      contentFormat: 'html',
      contactUuids: [contact.uuid],
      inactiveAfterMinutes: 1440,
    };
    const newLetter = {
      title: newInput.title,
      content: newInput.content,
      contentFormat: 'html',
      inactiveAfterMinutes: 1440,
      user: owner,
      contacts: [contact],
      deliveryEnabled: true,
    };
    const count = await letters.count();
    await assert.rejects(service.insert(newLetter, {}), { status: 409 });
    assert.equal(await letters.count(), count);
    const newReview = await service.previewDelivery(owner.uuid, newInput);
    const created = await service.insert(newLetter, { token: newReview.token });
    assert.equal(created.deliveryEnabled, true);
    assert.notEqual(created.uuid, draft.uuid);
    assert.equal(created.contacts[0].email, 'new-family@example.test');
    await assert.rejects(
      service.previewDelivery(owner.uuid, { ...newInput, content: input.content }),
      { status: 400 },
    );
    console.log(
      'MySQL: fresh and incremental migrations, reviewed creates/updates, user-lock serialization, liveness and attachment ownership passed.',
    );
  } finally {
    if (source?.isInitialized) await source.destroy();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
    await rm(resources, { recursive: true, force: true });
  }
}

verify().catch((error) => {
  // 驱动错误仅报告代码，避免连接信息或 SQL 出现在输出中。
  // Report driver codes only so connection details and SQL never reach the log.
  const code = error.code || error.driverError?.code;
  console.error(code ? `MySQL verification failed: ${code}` : error);
  process.exitCode = 1;
});
