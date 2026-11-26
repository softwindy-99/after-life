import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.UI_TEST_PORT || 5192);
const origin = `http://127.0.0.1:${port}`;
const screenshots =
  process.env.UI_SCREENSHOT_DIR || (await mkdtemp(join(tmpdir(), 'after-life-ui-')));
await mkdir(screenshots, { recursive: true });
let server;
let browser;
before(async () => {
  server = spawn(
    process.execPath,
    [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port)],
    { cwd: root, stdio: 'ignore' },
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null)
      throw new Error('Vite preview failed to start; check UI_TEST_PORT.');
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* Wait for the local preview only. */
    }
    if (attempt === 99) throw new Error('Vite preview did not become ready.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
  });
});
after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
  console.log(`UI screenshots: ${screenshots}`);
});

const now = new Date().toISOString();
const contact = {
  uuid: 'contact-demo',
  name: '妈妈',
  email: 'family@example.test',
  phone: '',
  note: '周末记得打电话',
  displaySummary: '妈妈',
  letters: [],
  updatedAt: now,
};
const letters = [
  {
    uuid: 'letter-demo',
    title: '给妈妈的一封信',
    content: '<p>最近有些忙，但一切都好。</p><p>那些没来得及说的话，我想慢慢写下来。</p>',
    contentFormat: 'html',
    excerpt: '最近有些忙，但一切都好。',
    deliveryEnabled: false,
    contacts: [contact],
    updatedAt: now,
  },
  {
    uuid: 'letter-future',
    title: '给未来的自己',
    content: '<p>愿你还记得出发时的心情。</p>',
    contentFormat: 'html',
    excerpt: '愿你还记得出发时的心情。',
    deliveryEnabled: true,
    inactiveAfterMinutes: 43200,
    contacts: [contact],
    updatedAt: now,
  },
];
const permissions = [{ uuid: 'permission-demo', name: 'admin', description: '管理系统' }];
const roles = [
  { uuid: 'role-admin', name: 'admin', description: '系统管理员', permissions },
  { uuid: 'role-user', name: 'user', description: '日常用户', permissions: [] },
];

async function fixture({
  admin = false,
  width = 1440,
  authenticated = true,
  empty = false,
  setup = false,
  unconfigured = false,
  checkedIn = true,
  firstStart = false,
  restarting = false,
} = {}) {
  const letterData = structuredClone(letters);
  const resourceRequests = [];
  const reviewState = { overdue: false, blockers: [] };
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    isMobile: width < 720,
    hasTouch: width < 1080,
    serviceWorkers: 'block',
  });
  if (authenticated)
    await context.addInitScript(() =>
      localStorage.setItem('after-life-admin-token', 'ui-test-fake-token'),
    );
  const firstBootId = '10000000-0000-4000-8000-000000000001';
  if (!firstStart) {
    await context.addCookies([
      {
        name: 'after-life-startup',
        value: '1',
        url: origin,
        sameSite: 'Lax',
        expires: Math.floor(Date.now() / 1000) + 31536000,
      },
    ]);
    await context.addInitScript(
      ({ needsSetup }) => {
        if (!localStorage.getItem('after-life-startup-v1'))
          localStorage.setItem(
            'after-life-startup-v1',
            JSON.stringify({ needsSetup, requiresRestart: false, initializing: false }),
          );
      },
      { needsSetup: unconfigured },
    );
  }
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  const unknown = [];
  const writes = [];
  const storage = {
    driver: 'local',
    endpoint: '',
    region: '',
    bucket: '',
    prefix: 'after-life',
    forcePathStyle: true,
    credentialsConfigured: false,
    writable: true,
    localCount: 3,
    externalCount: 0,
  };
  const setupVerificationHeaders = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const user = {
    uuid: 'user-demo',
    username: 'Andrew',
    email: 'andrew@example.test',
    role: roles[admin ? 0 : 1],
  };
  const mcpPermissions = [
    ['mcp:letters:read', '读取信件', '可获取信件标题、正文、检测规则和附件引用。'],
    ['mcp:contacts:read', '读取联系人', '可获取联系人姓名、邮箱、电话和备注。'],
    ['mcp:resources:read', '读取附件', '可下载私有附件，内容可能进入 AI 服务。'],
    ['mcp:letters:write', '编辑信件', '可改变将来投递的内容及绑定联系人。'],
    ['mcp:contacts:write', '管理联系人', '修改联系方式会影响实际收件人。'],
    ['mcp:resources:write', '上传附件', '上传文件会占用存储额度。'],
    ['mcp:delivery:write', '管理检测与自动投递', '改变触发规则，超时启用需人类确认。'],
    [
      'mcp:check-in:write',
      '根据人类交互辅助签到',
      '信任 agent 报告真实人类交互，会推迟投递；后台活动不得续期。',
    ],
  ].map(([scope, label, risk]) => ({ scope, label, risk }));
  const pendingMcpEvent = {
    uuid: 'approval-demo',
    authUuid: 'grant-demo',
    tool: 'afterlife_preview_delivery',
    resourceUuid: 'letter-demo',
    outcome: 'pending',
    createdAt: now,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    details: {
      expectedUpdatedAt: now,
      inactiveAfterMinutes: 60,
      dueAt: now,
      resourceCount: 1,
      contactCount: 1,
    },
  };
  const mcpData = {
    permissions: mcpPermissions,
    grants: [
      {
        uuid: 'grant-demo',
        name: '日常助手',
        scopes: ['mcp:read', 'mcp:letters:read', 'mcp:contacts:read'],
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        lastUsedAt: now,
        lastCheckInAt: null,
        legacy: false,
        createdAt: now,
      },
    ],
    events: [pendingMcpEvent],
    pending: [pendingMcpEvent],
    page: 1,
    total: 1,
  };
  let failLetter = false;
  let failOperations = false;
  let failStatus = false;
  let serviceRestarting = restarting;
  let bootId = firstBootId;
  let letterRelease;
  let letterGate;
  let setupRelease;
  const setupGate = new Promise((resolve) => {
    setupRelease = resolve;
  });
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    const method = request.method();
    if (path.startsWith('/setup'))
      setupVerificationHeaders.push(Boolean(request.headers()['x-setup-token']));
    let data;
    if (method !== 'GET') {
      writes.push({ path, method, body: request.postDataJSON() });
      if (failOperations)
        return route.fulfill({
          status: 503,
          json: { message: '操作暂时失败，请稍后重试。', statusCode: 503 },
        });
      if (path === '/letter' && letterGate) await letterGate;
      if (path === '/letter' && failLetter)
        return route.fulfill({
          status: 400,
          json: { message: '请选择至少一位联系人。', statusCode: 400 },
        });
      if (path === '/letter/delivery-preview') {
        const body = request.postDataJSON();
        const recipients = body.contactUuids.includes(contact.uuid) ? [contact] : [];
        const blockers = [
          ...reviewState.blockers,
          ...(!recipients.length ? ['请至少选择一位有邮箱的联系人。'] : []),
        ];
        const baselineAt = new Date(
          reviewState.overdue
            ? Date.now() - Number(body.inactiveAfterMinutes) * 60000 - 60000
            : now,
        );
        data = {
          baselineAt: baselineAt.toISOString(),
          baselineSource: checkedIn ? 'check-in' : 'account-created',
          dueAt: new Date(
            baselineAt.getTime() + Number(body.inactiveAfterMinutes) * 60000,
          ).toISOString(),
          overdue: reviewState.overdue,
          recipients,
          skippedContacts: [],
          resourceCount: 0,
          retentionDays: 30,
          blockers,
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          token: blockers.length ? null : 'mock-reviewed-payload',
        };
      } else if (path === '/admin/storage' && method === 'PUT') {
        const { accessKeyId, accessKeySecret, ...settings } = request.postDataJSON();
        Object.assign(storage, settings, {
          credentialsConfigured:
            Boolean(accessKeyId && accessKeySecret) || storage.credentialsConfigured,
        });
        data = storage;
      } else if (path === '/admin/storage/migrate') {
        const migrated = Math.min(storage.localCount, 2);
        storage.localCount -= migrated;
        storage.externalCount += migrated;
        data = { migrated, remaining: storage.localCount };
      } else if (path === '/admin/storage/test') {
        data = { ok: true };
      } else if (path === '/mcp-settings/grants' && method === 'POST') {
        const body = request.postDataJSON();
        mcpData.grants.push({
          uuid: 'new-grant',
          ...body,
          scopes: ['mcp:read', ...body.scopes],
          legacy: false,
          expiresAt:
            body.days === null ? null : new Date(Date.now() + body.days * 86400000).toISOString(),
          lastUsedAt: null,
          lastCheckInAt: null,
          createdAt: now,
        });
        data = {
          token: 'mock-one-time-mcp-token',
          expiresInSeconds: body.days === null ? null : body.days * 86400,
          scopes: body.scopes,
        };
      } else if (path.startsWith('/mcp-settings/grants') && method === 'DELETE') {
        mcpData.grants = path.endsWith('/grants')
          ? []
          : mcpData.grants.filter((grant) => grant.uuid !== path.split('/').at(-1));
        data = { ok: true };
      } else if (path.startsWith('/mcp-settings/approvals/')) {
        mcpData.pending = [];
        data = { ok: true };
      } else if (path === '/auth') data = 'ui-test-fake-token';
      else if (path === '/check-in') data = { uuid: 'check-demo', checkedAt: now, source: 'web' };
      else if (path === '/letter' && method === 'POST') {
        const body = request.postDataJSON();
        data = {
          ...letterData[0],
          ...body,
          uuid: 'letter-created',
          updatedAt: now,
          contacts: body.contactUuids?.includes(contact.uuid) ? [contact] : [],
        };
        letterData.unshift(data);
      } else if (path.startsWith('/letter/') && method === 'PUT') {
        const index = letterData.findIndex((letter) => letter.uuid === path.split('/').at(-1));
        data = { ...letterData[index], ...request.postDataJSON() };
        letterData[index] = data;
      } else data = { ok: true };
    } else if (path === '/setup/status') {
      if (failStatus)
        return route.fulfill({ status: 503, json: { message: '服务尚未连接。', statusCode: 503 } });
      if (setup) await setupGate;
      data = {
        bootId,
        needsSetup: unconfigured,
        requiresRestart: serviceRestarting,
        initializing: false,
        ...(unconfigured ? { missingKeys: ['PORT'], values: {} } : {}),
      };
    } else if (path === '/mcp-settings')
      data = { ...mcpData, page: Number(new URL(request.url()).searchParams.get('page') || 1) };
    else if (path.startsWith('/mcp-settings/approvals/'))
      data = {
        event: pendingMcpEvent,
        letter: letters[0],
        resources: [
          {
            uuid: 'file-demo',
            filename: '给家人的说明.pdf',
            sizeBytes: 1024,
            url: '/resource/file-demo/file?expires=1&signature=fake',
          },
        ],
      };
    else if (path === '/user') data = user;
    else if (path === '/user/avatar') data = { avatar: null };
    else if (path === '/letter') data = empty ? [] : letterData;
    else if (path === '/contact') data = empty ? [] : [contact];
    else if (path === '/check-in/status')
      data = {
        lastSeenAt: checkedIn ? now : null,
        checkIn: null,
        baselineAt: now,
        baselineSource: checkedIn ? 'check-in' : 'account-created',
      };
    else if (/^\/resource\/[^/]+\/access$/.test(path)) {
      resourceRequests.push(path);
      data = { url: path.replace('/access', '/file?expires=2000000000&signature=mock') };
    } else if (/^\/resource\/[^/]+\/file$/.test(path)) {
      return route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0f8AAAAASUVORK5CYII=',
          'base64',
        ),
      });
    } else if (path === '/notification/config') data = { configured: false, publicKey: '' };
    else if (path === '/admin/dashboard')
      data = {
        totals: { users: 12, admins: 1, letters: 28, contacts: 16, roles: 2, resourceBytes: 20480 },
        recentUsers: [user],
        recentLetters: [],
        roleDistribution: [
          { roleUuid: 'role-admin', roleName: 'admin', userCount: 1, permissionNames: [] },
        ],
      };
    else if (path === '/role') data = roles;
    else if (path === '/permission') data = permissions;
    else if (path === '/mail/config')
      data = {
        host: '',
        port: 465,
        secure: true,
        user: '',
        from: '',
        configured: false,
        missingKeys: [],
      };
    else if (path === '/admin/storage') data = storage;
    else if (path === '/admin/settings')
      data = {
        pushProxy: '',
        pushProxyConfigured: false,
        pushProxyValid: false,
        pushProxyHasCredentials: false,
        pushProxySource: null,
      };
    else if (path === '/user/list') data = { data: [user], total: 1 };
    else {
      unknown.push(path);
      return route.abort();
    }
    return route.fulfill({ json: { data, message: 'OK', statusCode: 200 } });
  });
  return {
    page,
    writes,
    letterData,
    resourceRequests,
    reviewState,
    releaseSetup: setupRelease,
    failLetters: () => {
      failLetter = true;
    },
    failOperations: () => {
      failOperations = true;
    },
    restart: () => {
      bootId = '10000000-0000-4000-8000-000000000002';
    },
    failStatus: (value) => {
      failStatus = value;
    },
    completeRestart: () => {
      serviceRestarting = false;
    },
    holdLetters: () => {
      letterGate = new Promise((resolve) => {
        letterRelease = resolve;
      });
    },
    releaseLetters: () => letterRelease?.(),
    async close() {
      await context.close();
      assert.deepEqual(errors, [], 'No uncaught browser errors');
      assert.deepEqual(unknown, [], 'All API calls must be mocked');
      assert.equal(
        setupVerificationHeaders.some(Boolean),
        false,
        'Setup sends no installation verification header',
      );
    },
  };
}

async function visit(page, path = '/') {
  await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
  await page.locator('main h1').waitFor();
  await page.locator('.page-transition > :not(.ui-spinner)').first().waitFor();
}
async function noOverflow(page) {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
    'The document should not scroll horizontally',
  );
}
async function capture(page, name) {
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: join(screenshots, name + '.png'),
    fullPage: true,
    animations: 'disabled',
  });
}

test('startup waits for the backend, uses a cookie and does not replay after backend restart', async () => {
  const f = await fixture({ authenticated: false, setup: true, firstStart: true });
  try {
    await f.page.goto(origin, { waitUntil: 'domcontentloaded' });
    await f.page.locator('.boot-status').waitFor();
    assert.equal(
      await f.page
        .locator('.startup-screen svg, .startup-screen img, .startup-screen canvas')
        .count(),
      0,
    );
    assert.equal(
      await f.page.getByRole('list', { name: '启动阶段' }).getByRole('listitem').count(),
      4,
    );
    assert.equal(await f.page.getByRole('progressbar').getAttribute('aria-valuenow'), null);
    await capture(f.page, 'boot');
    assert.equal(await f.page.getByRole('button', { name: '跳过动画' }).isDisabled(), true);
    f.releaseSetup();
    await f.page.getByRole('heading', { name: '服务已响应，正在展开入口。' }).waitFor();
    assert.equal(await f.page.locator('.startup-steps [data-state="complete"]').count(), 1);
    assert.equal(await f.page.locator('.startup-heading h1').count(), 0);
    const log = f.page.getByRole('log', { name: '启动终端输出' });
    assert.equal(await log.getByRole('heading', { name: '服务已响应，正在展开入口。' }).count(), 1);
    assert.equal(await log.locator('.startup-log-line').count(), 2);
    await capture(f.page, 'boot-calibration');
    await f.page.getByRole('heading', { name: '正在载入入口界面。' }).waitFor();
    assert.equal(await f.page.locator('.startup-steps [data-state="complete"]').count(), 2);
    assert.equal(
      await f.page
        .locator('.startup-steps [data-state="active"]')
        .textContent()
        .then((text) => text.includes('入口界面')),
      true,
    );
    assert.equal(
      await f.page.evaluate(() => document.cookie.includes('after-life-startup=1')),
      false,
    );
    assert.equal(await log.locator('.startup-log-line').count(), 3);
    await capture(f.page, 'boot-loading');
    await f.page.getByRole('heading', { name: '入口已就绪，准备进入。' }).waitFor();
    assert.equal(await f.page.locator('.startup-steps [data-state="complete"]').count(), 4);
    assert.equal(await log.locator('.startup-log-line').count(), 4);
    assert.equal(
      await log.locator('.startup-log-line').last().getByRole('heading').textContent(),
      '入口已就绪，准备进入。',
    );
    await capture(f.page, 'boot-ready');
    await f.page.getByRole('button', { name: /进入/ }).waitFor();
    await f.page.getByLabel(/^密码/).fill('fake-test-password');
    await f.page.getByRole('button', { name: '显示密码' }).click();
    assert.equal(await f.page.getByLabel(/^密码/).getAttribute('type'), 'text');
    await f.page.getByRole('button', { name: '隐藏密码' }).click();
    await f.page.getByLabel(/^密码/).fill('');
    await capture(f.page, 'login');
    await noOverflow(f.page);
    const cookie = (await f.page.context().cookies(origin)).find(
      (cookie) => cookie.name === 'after-life-startup',
    );
    assert.equal(cookie.value, '1');
    assert.equal(cookie.sameSite, 'Lax');
    assert.equal(cookie.path, '/');
    assert.ok(cookie.expires > Date.now() / 1000 + 300 * 24 * 60 * 60);
    await f.page.reload({ waitUntil: 'domcontentloaded' });
    await f.page.getByRole('button', { name: /进入/ }).waitFor();
    assert.equal(await f.page.locator('.startup-screen').count(), 0);
    f.restart();
    await f.page.reload({ waitUntil: 'domcontentloaded' });
    await f.page.getByRole('button', { name: /进入/ }).waitFor();
    assert.equal(await f.page.locator('.startup-screen').count(), 0);
    await f.page.evaluate(() => {
      document.cookie = 'after-life-startup=; Path=/; Max-Age=0';
    });
    await f.page.reload({ waitUntil: 'domcontentloaded' });
    await f.page.getByRole('heading', { name: '服务已响应，正在展开入口。' }).waitFor();
    await f.page.getByRole('button', { name: '跳过动画' }).click();
    await f.page.getByRole('button', { name: /进入/ }).waitFor();
    assert.equal(
      await f.page.evaluate(() => document.cookie.includes('after-life-startup=1')),
      true,
    );
  } finally {
    await f.close();
  }
});

test('setup wizard validates without writes and adapts to phones', async () => {
  const f = await fixture({ authenticated: false, unconfigured: true });
  try {
    await f.page.goto(origin, { waitUntil: 'domcontentloaded' });
    await f.page.getByRole('heading', { name: '部署初始化向导' }).waitFor();
    await f.page.getByRole('button', { name: '下一步', exact: true }).click();
    await f.page.getByRole('alert').first().waitFor();
    await capture(f.page, 'setup');
    await noOverflow(f.page);
    await f.page.setViewportSize({ width: 320, height: 800 });
    await noOverflow(f.page);
    await capture(f.page, 'mobile-setup');
    assert.equal(f.writes.length, 0);
  } finally {
    await f.close();
  }
});

test('container setup reuses a masked password and requires a new one for changed connections', async () => {
  const f = await fixture({ authenticated: false, unconfigured: true });
  await f.page.route('**/api/setup/status', (route) =>
    route.fulfill({
      json: {
        data: {
          needsSetup: true,
          requiresRestart: false,
          initializing: false,
          databasePasswordConfigured: true,
          missingKeys: ['INIT_ADMIN_PASSWORD'],
          values: {
            PORT: '3000',
            DB_HOST: '127.0.0.1',
            DB_PORT: '3306',
            DB_USER: 'after_life',
            DB_NAME: 'after_life',
            DB_PASSWORD: '',
          },
        },
      },
    }),
  );
  await f.page.route('**/api/setup/database/check', (route) =>
    route.fulfill({ json: { data: { connected: true } } }),
  );
  try {
    await f.page.goto(origin, { waitUntil: 'domcontentloaded' });
    await f.page.getByRole('heading', { name: '部署初始化向导' }).waitFor();
    assert.equal(await f.page.getByLabel('服务端端口').inputValue(), '3000');
    await f.page.getByRole('button', { name: '下一步', exact: true }).click();
    assert.equal(await f.page.getByLabel('数据库用户').inputValue(), 'after_life');
    const password = f.page.getByLabel('数据库密码');
    assert.equal(await password.inputValue(), '');
    assert.equal(await password.getAttribute('placeholder'), '已配置，留空使用现有密码');
    assert.equal(await password.getAttribute('required'), null);
    await f.page.getByRole('button', { name: '测试连接', exact: true }).click();
    await f.page.getByText('数据库连接测试通过。').waitFor();
    await f.page.getByLabel('数据库地址').fill('other-host');
    assert.notEqual(await password.getAttribute('required'), null);
    await f.page.getByRole('button', { name: '下一步', exact: true }).click();
    await f.page.getByText('请输入数据库密码。').waitFor();
    await f.page.getByLabel('数据库地址').fill('127.0.0.1');
    await f.page.getByRole('button', { name: '下一步', exact: true }).click();
    await f.page.getByRole('button', { name: '下一步', exact: true }).click();
    await f.page.getByLabel('管理员名称').fill('Admin');
    await f.page.getByLabel('管理员邮箱').fill('admin@example.test');
    await f.page.getByLabel('管理员密码').fill('new-admin-password');
    await f.page.getByRole('button', { name: '下一步', exact: true }).click();
    await f.page.getByLabel('账户名称').fill('Alice');
    await f.page.getByLabel('登录邮箱').fill('alice@example.test');
    await f.page.getByLabel('登录密码').fill('new-user-password');
    await f.page.getByLabel('确认密码').fill('new-user-password');
    await f.page.getByRole('button', { name: '完成初始化', exact: true }).click();
    await f.page.getByRole('heading', { name: '初始化已完成' }).waitFor();
    const submission = f.writes.find((write) => write.path === '/setup');
    assert.equal('DB_PASSWORD' in submission.body, false);
    assert.equal(submission.body.DB_HOST, '127.0.0.1');
    assert.equal(submission.body.DB_USER, 'after_life');
    assert.equal(submission.body.INIT_ADMIN_EMAIL, 'admin@example.test');
    assert.deepEqual(submission.body.initialUser, {
      username: 'Alice',
      email: 'alice@example.test',
      password: 'new-user-password',
    });
  } finally {
    await f.close();
  }
});

for (const width of [390, 1440]) {
  test(`object storage configuration, connection test and resumable batches at ${width}px`, async () => {
    const f = await fixture({ admin: true, width });
    try {
      await visit(f.page, '/settings');
      await f.page.getByRole('combobox', { name: '存储服务', exact: true }).click();
      await f.page.getByRole('option', { name: 'S3 兼容（MinIO / Amazon S3）' }).click();
      await f.page.getByLabel('Endpoint', { exact: true }).fill('https://minio.example.test');
      await f.page.getByLabel('区域 Region', { exact: true }).fill('us-east-1');
      await f.page.getByLabel('Bucket', { exact: true }).fill('private-files');
      await f.page.getByLabel('Access Key ID', { exact: true }).fill('test-id');
      await f.page.getByLabel('Access Key Secret', { exact: true }).fill('test-secret');
      assert.equal(await f.page.getByRole('button', { name: '迁移本地文件' }).isEnabled(), false);
      await f.page.getByRole('button', { name: '测试连接' }).click();
      await f.page.getByRole('status').filter({ hasText: '连接测试通过' }).waitFor();
      await f.page.getByRole('button', { name: '保存存储配置' }).click();
      await f.page.getByRole('status').filter({ hasText: '存储配置已保存' }).waitFor();
      assert.equal(await f.page.getByLabel('Access Key Secret', { exact: true }).inputValue(), '');
      await f.page.getByRole('button', { name: '迁移本地文件' }).click();
      await f.page.getByRole('status').filter({ hasText: '迁移完成，共迁移 3 个文件' }).waitFor();
      assert.equal(f.writes.filter((write) => write.path === '/admin/storage/migrate').length, 2);
      await noOverflow(f.page);
      await f.page.screenshot({ path: join(screenshots, `storage-${width}.png`), fullPage: true });
    } finally {
      await f.close();
    }
  });
}

test('setup step transitions preserve drafts, keyboard focus and motion preferences without writes', async () => {
  const f = await fixture({ authenticated: false, unconfigured: true });
  try {
    await f.page.emulateMedia({ reducedMotion: 'no-preference' });
    await f.page.goto(origin, { waitUntil: 'domcontentloaded' });
    await f.page.getByRole('heading', { name: '部署初始化向导' }).waitFor();
    await f.page.getByLabel('服务端端口').fill('3000');
    await f.page.getByRole('button', { name: '下一步', exact: true }).click();
    await f.page.getByRole('group', { name: '数据库', exact: true }).waitFor();
    assert.equal(
      await f.page
        .getByRole('button', { name: '下一步', exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    assert.notEqual(
      await f.page
        .locator('.setup-step-content')
        .evaluate((element) => getComputedStyle(element).animationName),
      'none',
    );
    await f.page.getByLabel('数据库用户').fill('wizard-preview-user');
    const steps = f.page.getByRole('navigation', { name: '初始化步骤' });
    await steps.getByRole('button', { name: '邮件', exact: true }).focus();
    await f.page.keyboard.press('Space');
    await f.page.getByRole('group', { name: '邮件', exact: true }).waitFor();
    assert.equal(
      await steps
        .getByRole('button', { name: '邮件', exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await f.page.getByLabel('邮件服务器').fill('smtp.example.test');
    await f.page.getByRole('button', { name: '上一步', exact: true }).click();
    assert.equal(await f.page.getByLabel('数据库用户').inputValue(), 'wizard-preview-user');
    await f.page.getByRole('button', { name: '上一步', exact: true }).click();
    assert.equal(await f.page.getByLabel('服务端端口').inputValue(), '3000');
    await steps.getByRole('button', { name: '数据库', exact: true }).click();
    await steps.getByRole('button', { name: '邮件', exact: true }).click();
    await steps.getByRole('button', { name: '基础配置', exact: true }).click();
    assert.equal(await f.page.getByRole('group', { name: '基础配置', exact: true }).count(), 1);
    await f.page.getByRole('button', { name: '界面动态效果' }).click();
    await steps.getByRole('button', { name: '邮件', exact: true }).click();
    assert.equal(await f.page.getByLabel('邮件服务器').inputValue(), 'smtp.example.test');
    assert.equal(
      await f.page
        .locator('.setup-step-content')
        .evaluate((element) => getComputedStyle(element).animationName),
      'none',
    );
    await f.page.getByRole('button', { name: '界面动态效果' }).click();
    await f.page.emulateMedia({ reducedMotion: 'reduce' });
    await steps.getByRole('button', { name: '数据库', exact: true }).click();
    assert.equal(
      await f.page
        .locator('.setup-step-content')
        .evaluate((element) => getComputedStyle(element).animationName),
      'none',
    );
    await f.page.setViewportSize({ width: 320, height: 800 });
    await noOverflow(f.page);
    await capture(f.page, 'setup-step-database');
    assert.equal(f.writes.length, 0);
  } finally {
    await f.close();
  }
});

test('failed startup can retry without setting the played cookie', async () => {
  const f = await fixture({ authenticated: false, firstStart: true, width: 320 });
  try {
    f.failStatus(true);
    await f.page.goto(origin, { waitUntil: 'domcontentloaded' });
    await f.page.getByRole('heading', { name: '暂时无法连接服务' }).waitFor();
    assert.equal(await f.page.evaluate(() => localStorage.getItem('after-life-startup-v1')), null);
    assert.equal(
      await f.page.evaluate(() => document.cookie.includes('after-life-startup=1')),
      false,
    );
    assert.equal(await f.page.getByRole('button', { name: '跳过动画' }).count(), 0);
    await noOverflow(f.page);
    await capture(f.page, 'mobile-startup-error');
    f.failStatus(false);
    await f.page.getByRole('button', { name: '重新连接' }).click();
    await f.page.getByRole('heading', { name: '服务已响应，正在展开入口。' }).waitFor();
    await noOverflow(f.page);
    await capture(f.page, 'mobile-startup');
    await f.page.getByRole('button', { name: '跳过动画' }).click();
    await f.page.getByRole('heading', { name: '留一些话，给重要的人。' }).waitFor();
    assert.notEqual(
      await f.page.evaluate(() => localStorage.getItem('after-life-startup-v1')),
      null,
    );
  } finally {
    await f.close();
  }
});

test('a played cookie shows login while checking and ambient motion can be paused persistently', async () => {
  const f = await fixture({ authenticated: false, setup: true });
  try {
    await f.page.goto(origin, { waitUntil: 'domcontentloaded' });
    await f.page.getByRole('heading', { name: '留一些话，给重要的人。' }).waitFor();
    assert.equal(await f.page.locator('.startup-screen').count(), 0);
    assert.equal(await f.page.getByRole('button', { name: /进入/ }).isDisabled(), true);
    f.releaseSetup();
    await f.page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
    await f.page.getByLabel('邮箱').fill('preview@example.test');
    assert.equal(
      await f.page
        .locator('.auth-orbit-one')
        .evaluate((element) => getComputedStyle(element).animationPlayState),
      'paused',
    );
    await f.page.getByRole('button', { name: '界面动态效果' }).click();
    assert.equal(
      await f.page.getByRole('button', { name: '界面动态效果' }).getAttribute('aria-pressed'),
      'false',
    );
    assert.equal(
      await f.page
        .locator('.auth-orbit-one')
        .evaluate((element) => getComputedStyle(element).animationName),
      'none',
    );
    await f.page.reload({ waitUntil: 'domcontentloaded' });
    await f.page.getByRole('button', { name: '界面动态效果' }).waitFor();
    assert.equal(
      await f.page.getByRole('button', { name: '界面动态效果' }).getAttribute('aria-pressed'),
      'false',
    );
    assert.equal(await f.page.locator('.startup-screen').count(), 0);
  } finally {
    await f.close();
  }
});

test('reduced motion skips the cinematic delay and opens setup without installation verification', async () => {
  const f = await fixture({
    authenticated: false,
    unconfigured: true,
    firstStart: true,
  });
  try {
    await f.page.emulateMedia({ reducedMotion: 'reduce' });
    await f.page.goto(origin, { waitUntil: 'domcontentloaded' });
    await f.page.getByRole('heading', { name: '部署初始化向导' }).waitFor({ timeout: 1500 });
    assert.equal(await f.page.locator('.startup-screen').count(), 0);
    assert.equal(await f.page.getByRole('button', { name: '界面动态效果' }).isVisible(), false);
    assert.equal(
      await f.page
        .locator('.auth-orbit-one')
        .evaluate((element) => getComputedStyle(element).animationName),
      'none',
    );
    assert.equal(await f.page.getByLabel('安装密钥').count(), 0);
    await capture(f.page, 'setup-direct');
    await f.page.setViewportSize({ width: 320, height: 800 });
    await noOverflow(f.page);
    await f.page.getByRole('heading', { name: '部署初始化向导' }).waitFor();
    assert.equal(await f.page.locator('.startup-screen').count(), 0);
    const snapshot = await f.page.evaluate(() =>
      JSON.parse(localStorage.getItem('after-life-startup-v1')),
    );
    assert.deepEqual(Object.keys(snapshot).sort(), [
      'initializing',
      'needsSetup',
      'requiresRestart',
    ]);
    assert.equal(f.writes.length, 0);
  } finally {
    await f.close();
  }
});

test('startup query controls force playback, skip and reset without changing other URL parameters', async () => {
  const f = await fixture({ authenticated: false });
  try {
    await f.page.goto(origin + '/login?startup=play', { waitUntil: 'domcontentloaded' });
    await f.page.getByRole('heading', { name: '服务已响应，正在展开入口。' }).waitFor();
    await f.page.getByRole('button', { name: '跳过动画' }).click();
    await f.page.getByRole('button', { name: /进入/ }).waitFor();
    await f.page.reload({ waitUntil: 'domcontentloaded' });
    await f.page.getByRole('heading', { name: '服务已响应，正在展开入口。' }).waitFor();
    await f.page.getByRole('button', { name: '跳过动画' }).click();
    await f.page.goto(origin + '/login?theme=test&startup=reset#preview', {
      waitUntil: 'domcontentloaded',
    });
    await f.page.getByRole('heading', { name: '服务已响应，正在展开入口。' }).waitFor();
    assert.equal(new URL(f.page.url()).search, '?theme=test');
    assert.equal(new URL(f.page.url()).hash, '#preview');
    assert.equal(
      await f.page.evaluate(() => document.cookie.includes('after-life-startup=1')),
      false,
    );
    await f.page.getByRole('button', { name: '跳过动画' }).click();
    await f.page.reload({ waitUntil: 'domcontentloaded' });
    await f.page.getByRole('button', { name: /进入/ }).waitFor();
    assert.equal(await f.page.locator('.startup-screen').count(), 0);
    await f.page.evaluate(() => {
      document.cookie = 'after-life-startup=; Path=/; Max-Age=0';
      localStorage.removeItem('after-life-startup-v1');
    });
    await f.page.goto(origin + '/login?startup=skip', { waitUntil: 'domcontentloaded' });
    await f.page.getByRole('button', { name: /进入/ }).waitFor();
    assert.equal(await f.page.locator('.startup-screen').count(), 0);
    await f.page.waitForFunction(() => document.cookie.includes('after-life-startup=1'));
    assert.equal(f.writes.length, 0);
  } finally {
    await f.close();
  }
});

test('annotation preview stays on the finished frame, freezes motion and supports replay and manual entry', async () => {
  const f = await fixture({ authenticated: false, setup: true });
  try {
    await f.page.clock.install();
    await f.page.goto(origin + '/?startup=hold', { waitUntil: 'domcontentloaded' });
    await f.page.getByRole('heading', { name: '连接服务，确认系统入口。' }).waitFor();
    assert.equal(await f.page.getByRole('button', { name: '跳到结束画面' }).isDisabled(), true);
    f.releaseSetup();
    await f.page.getByRole('heading', { name: '服务已响应，正在展开入口。' }).waitFor();
    await f.page.clock.fastForward(5000);
    await f.page.getByRole('button', { name: '重新播放', exact: true }).waitFor();
    const screen = f.page.locator('.startup-screen');
    assert.equal(await screen.getAttribute('data-held'), 'true');
    assert.equal(await screen.getAttribute('data-phase'), 'ready');
    assert.equal(await screen.getAttribute('aria-busy'), 'false');
    assert.equal(
      await f.page.getByRole('progressbar', { name: '启动入口' }).getAttribute('aria-valuenow'),
      '100',
    );
    assert.equal(await f.page.locator('.startup-steps [data-state="complete"]').count(), 4);
    assert.equal(
      await screen.evaluate(
        (element) =>
          element
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === 'running').length,
      ),
      0,
    );
    await f.page.clock.fastForward(60000);
    assert.equal(await screen.isVisible(), true, 'Preview must remain after all automatic timers');
    await capture(f.page, 'startup-held');
    await f.page.setViewportSize({ width: 320, height: 800 });
    await noOverflow(f.page);
    await capture(f.page, 'mobile-startup-held');
    await f.page.getByRole('button', { name: '重新播放', exact: true }).click();
    await f.page.getByRole('heading', { name: '服务已响应，正在展开入口。' }).waitFor();
    assert.equal(await screen.getAttribute('data-held'), null);
    assert.equal(
      await f.page.getByRole('log', { name: '启动终端输出' }).locator('.startup-log-line').count(),
      2,
      'Replay clears the old command history',
    );
    await f.page.getByRole('button', { name: '跳到结束画面' }).click();
    await f.page.getByRole('button', { name: '继续进入', exact: true }).waitFor();
    await f.page.clock.fastForward(1500);
    assert.equal(
      await screen.getAttribute('data-phase'),
      'ready',
      'Skipping cancels remaining animation stages',
    );
    await f.page.getByRole('button', { name: '继续进入', exact: true }).click();
    await f.page.getByRole('button', { name: '进入我的空间', exact: true }).waitFor();
    assert.equal(await screen.count(), 0);
    assert.equal(new URL(f.page.url()).searchParams.has('startup'), false);
    assert.equal(f.writes.length, 0);
  } finally {
    await f.close();
  }
});

test('annotation preview respects reduced motion and manually enters setup when installation is required', async () => {
  const f = await fixture({ authenticated: false, unconfigured: true });
  try {
    await f.page.emulateMedia({ reducedMotion: 'reduce' });
    await f.page.goto(origin + '/?startup=hold', { waitUntil: 'domcontentloaded' });
    await f.page.getByRole('button', { name: '继续进入', exact: true }).waitFor({ timeout: 1500 });
    assert.equal(await f.page.locator('.startup-screen').getAttribute('data-phase'), 'ready');
    assert.equal(await f.page.locator('.startup-screen').getAttribute('data-held'), 'true');
    await f.page.getByRole('button', { name: '继续进入', exact: true }).click();
    await f.page.getByRole('heading', { name: '部署初始化向导' }).waitFor();
    assert.equal(await f.page.locator('.startup-screen').count(), 0);
    assert.equal(f.writes.length, 0);
  } finally {
    await f.close();
  }
});

test('setup readiness refresh preserves annotation previews and ordinary startup still redirects', async () => {
  for (const mode of ['hold', 'play']) {
    const f = await fixture({ authenticated: false, restarting: true });
    try {
      await f.page.clock.install();
      await f.page.emulateMedia({ reducedMotion: 'reduce' });
      await f.page.goto(origin + '/?startup=' + mode, { waitUntil: 'domcontentloaded' });
      if (mode === 'hold')
        await f.page.getByRole('button', { name: '继续进入', exact: true }).waitFor();
      else await f.page.getByRole('heading', { name: '正在应用部署配置' }).waitFor();
      f.completeRestart();
      const ready = f.page.waitForResponse((response) =>
        response.url().endsWith('/api/setup/status'),
      );
      await f.page.clock.fastForward(2000);
      await ready;
      if (mode === 'hold') {
        await f.page.waitForFunction(
          () => JSON.parse(localStorage.getItem('after-life-startup-v1')).requiresRestart === false,
        );
        assert.equal(new URL(f.page.url()).searchParams.get('startup'), 'hold');
        assert.equal(await f.page.locator('.startup-screen').getAttribute('data-held'), 'true');
        await f.page.getByRole('button', { name: '继续进入', exact: true }).click();
      }
      await f.page.getByRole('button', { name: '进入我的空间', exact: true }).waitFor();
      assert.equal(new URL(f.page.url()).searchParams.has('startup'), false);
      assert.equal(await f.page.locator('.startup-screen').count(), 0);
      assert.equal(f.writes.length, 0);
    } finally {
      await f.close();
    }
  }
});

test('letters keep disabled delivery defaults, modal selects, nested editor dialogs and feedback usable', async () => {
  const f = await fixture();
  try {
    await visit(f.page, '/letters');
    await capture(f.page, 'letters');
    await f.page.getByRole('searchbox', { name: '搜索信件' }).fill('不存在');
    assert.equal(await f.page.getByText('没有匹配的信件').count(), 1);
    await f.page.getByRole('searchbox', { name: '搜索信件' }).fill('');
    await f.page.getByRole('button', { name: '写一封信', exact: true }).click();
    const dialog = f.page.getByRole('dialog', { name: '新建信件', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel('开启离线自动投递').isChecked(), false);
    assert.equal(await dialog.getByLabel('离线触发时间（分钟）').isDisabled(), true);
    await dialog.getByLabel('标题', { exact: true }).fill('测试草稿');
    await dialog.getByRole('button', { name: '投递联系人' }).click();
    await dialog.getByRole('checkbox', { name: /妈妈/ }).check();
    await f.page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), true, 'Escape dismisses the popover first');
    await dialog.getByRole('button', { name: '插入外链', exact: true }).click();
    const nested = f.page.getByRole('dialog', { name: '插入网页或附件链接' });
    await nested.getByLabel(/^网址/).fill('https://example.test');
    await nested.getByRole('button', { name: '插入', exact: true }).click();
    await nested.waitFor({ state: 'detached' });
    assert.equal(
      await dialog.getByRole('textbox', { name: '信件正文' }).textContent(),
      'https://example.test',
    );
    f.failLetters();
    f.holdLetters();
    await dialog.getByRole('button', { name: '创建信件', exact: true }).click();
    await f.page.waitForFunction(
      () => document.querySelector('dialog[open] button[type="submit"]')?.disabled,
    );
    assert.equal(await dialog.getByRole('button', { name: '关闭弹窗' }).isDisabled(), true);
    await f.page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), true, 'Busy forms must stay open');
    f.releaseLetters();
    await dialog.getByRole('alert').waitFor();
    assert.match(await dialog.getByRole('alert').textContent(), /联系人/);
    await dialog.getByRole('button', { name: '关闭提示' }).click();
    await capture(f.page, 'letter-editor');
    await f.page.keyboard.press('Escape');
    await f.page
      .getByRole('dialog', { name: '保留尚未提交的修改？' })
      .getByRole('button', { name: '保留草稿并关闭' })
      .click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(
      await f.page
        .getByRole('button', { name: '恢复草稿', exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(f.writes[0].body.deliveryEnabled, false);
    assert.equal(f.writes.length, 1, 'Nested form submission must not submit the letter');
  } finally {
    await f.close();
  }
});

async function fillLetter(page, title = '尚未提交的长信') {
  await page.getByRole('button', { name: '写一封信', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新建信件', exact: true });
  await editor.getByLabel('标题', { exact: true }).fill(title);
  await editor.getByRole('textbox', { name: '信件正文' }).fill('这段内容应该能够恢复。');
  return editor;
}

async function storedDraft(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) =>
      name.startsWith('after-life-letter-draft-v1:'),
    );
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
}

test('private browser drafts survive refresh and navigation, remain separate from delivery and clear after saving', async () => {
  const f = await fixture();
  try {
    await visit(f.page, '/letters');
    let editor = await fillLetter(f.page);
    assert.equal((await storedDraft(f.page)).draft.title, '尚未提交的长信');
    assert.equal(f.writes.length, 0, 'Typing must not update a live letter or check in');
    f.page.on('dialog', (dialog) => dialog.accept());
    await f.page.reload();
    await f.page.getByRole('button', { name: '恢复草稿', exact: true }).click();
    editor = f.page.getByRole('dialog', { name: '新建信件', exact: true });
    assert.equal(await editor.getByLabel('标题', { exact: true }).inputValue(), '尚未提交的长信');
    assert.match(await editor.getByRole('textbox', { name: '信件正文' }).textContent(), /能够恢复/);
    assert.equal(await editor.getByLabel('开启离线自动投递').isChecked(), false);
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    await f.page.getByRole('button', { name: '保留草稿并关闭', exact: true }).click();
    await f.page.goto(origin + '/contacts');
    await f.page.goto(origin + '/letters');
    await f.page.getByRole('button', { name: '恢复草稿', exact: true }).click();
    await f.page.getByRole('button', { name: '创建信件', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    assert.equal(await storedDraft(f.page), null);
    assert.equal(f.writes.filter((write) => write.path === '/letter').length, 1);
    assert.equal(
      f.writes.some((write) => write.path === '/check-in'),
      false,
    );
  } finally {
    await f.close();
  }
});

test('enabled-letter drafts never change or pause live delivery until an explicit save', async () => {
  const f = await fixture();
  try {
    await visit(f.page, '/letters');
    await f.page.getByRole('button', { name: /给未来的自己/ }).click();
    await f.page.getByRole('button', { name: '继续写', exact: true }).click();
    const editor = f.page.getByRole('dialog', { name: '编辑信件', exact: true });
    assert.match(await editor.getByRole('status').textContent(), /不会暂停正式投递/);
    await editor.getByLabel('标题', { exact: true }).fill('尚未正式更新的标题');
    await editor.getByLabel('开启离线自动投递').uncheck();
    assert.equal(f.writes.length, 0);
    assert.equal(f.letterData[1].deliveryEnabled, true);
    assert.equal(f.letterData[1].title, '给未来的自己');
    await editor.getByRole('button', { name: '保存修改', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    assert.equal(f.letterData[1].deliveryEnabled, false);
    assert.equal(f.letterData[1].title, '尚未正式更新的标题');
    assert.equal(await storedDraft(f.page), null);
  } finally {
    await f.close();
  }
});

test('session expiry preserves private drafts for reauthentication instead of treating expiry as explicit logout', async () => {
  const f = await fixture();
  try {
    await visit(f.page, '/letters');
    const editor = await fillLetter(f.page, '登录过期也要保留');
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    await f.page.getByRole('button', { name: '保留草稿并关闭', exact: true }).click();
    await f.page.route(
      '**/api/user',
      (route) => route.fulfill({ status: 401, json: { message: '登录已过期', statusCode: 401 } }),
      { times: 1 },
    );
    await f.page.reload();
    await f.page.getByRole('textbox', { name: '邮箱', exact: true }).waitFor();
    assert.equal((await storedDraft(f.page)).draft.title, '登录过期也要保留');
  } finally {
    await f.close();
  }
});

test('explicit logout in another tab closes the editor and cannot recreate a cleared private draft', async () => {
  const f = await fixture();
  try {
    await visit(f.page, '/letters');
    await fillLetter(f.page, '多标签页草稿');
    const sibling = await f.page.context().newPage();
    const errors = [];
    sibling.on('pageerror', (error) => errors.push(error.message));
    await visit(sibling, '/letters');
    await sibling.getByRole('button', { name: '退出登录', exact: true }).click();
    await f.page.getByRole('textbox', { name: '邮箱', exact: true }).waitFor();
    assert.equal(await f.page.getByRole('dialog').count(), 0);
    assert.equal(await storedDraft(f.page), null);
    assert.equal(
      f.writes.some((write) => write.path === '/letter'),
      false,
    );
    assert.deepEqual(errors, []);
    await sibling.close();
  } finally {
    await f.close();
  }
});

test('full letter preview preserves formatting, resolves each private resource once and rejects executable markup', async () => {
  const f = await fixture();
  const uuid = '11111111-2222-4333-8444-555555555555';
  f.letterData[0].content =
    '<h2>重要的话</h2><h3>次级标题</h3><p><strong>加粗内容</strong></p><ul><li>第一项</li></ul><blockquote>引用内容</blockquote>' +
    '<img alt="家庭照片" src="/resource/' +
    uuid +
    '"><p><a href="/resource/' +
    uuid +
    '">说明附件</a></p>' +
    '<script>window.letterXss = true</script><img src="javascript:alert(1)" onerror="window.letterXss=true"><a href="javascript:alert(1)">危险链接</a>';
  try {
    await visit(f.page, '/letters');
    const preview = f.page.getByRole('article', { name: '信件预览' });
    await preview.getByRole('heading', { name: '重要的话' }).waitFor();
    assert.equal(await preview.locator('strong').filter({ hasText: '加粗内容' }).count(), 1);
    assert.equal(await preview.getByRole('listitem').textContent(), '第一项');
    const attachment = preview.getByRole('link', { name: '说明附件' });
    assert.match(await attachment.getAttribute('href'), /\/api\/resource\/.+\/file\?/);
    assert.equal(await attachment.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(
      await preview.getByRole('img', { name: '家庭照片' }).getAttribute('src'),
      await attachment.getAttribute('href'),
    );
    const initialRequests = f.resourceRequests.length;
    assert.ok(
      initialRequests >= 1 && initialRequests <= 2,
      'StrictMode may cancel the first mount request',
    );
    assert.equal(await f.page.evaluate(() => window.letterXss), undefined);
    assert.equal(await preview.locator('script,[onerror],[href^="javascript:"]').count(), 0);
    await preview.getByRole('button', { name: '刷新附件链接' }).click();
    await f.page.waitForFunction(() => document.querySelector('.letter-reading img')?.complete);
    assert.equal(f.resourceRequests.length, initialRequests + 1);
    f.resourceRequests.length = 0;
    await f.page.evaluate(async (html) => {
      const { resolveLetterHtml } = await import('/src/lib/letter-content.ts');
      await resolveLetterHtml(html);
    }, f.letterData[0].content);
    assert.equal(f.resourceRequests.length, 1, 'Repeated references share one signing request');
    await capture(f.page, 'letter-full-preview');
  } finally {
    await f.close();
  }
});

test('enabling delivery requires the server review and explicit overdue acknowledgement before a write', async () => {
  const f = await fixture({ checkedIn: false });
  f.reviewState.overdue = true;
  try {
    await visit(f.page, '/letters');
    const editor = await fillLetter(f.page, '需要核对的信');
    await editor.getByLabel('开启离线自动投递').check();
    await editor.getByLabel('离线触发时间（分钟）').fill('1440');
    await editor.getByRole('button', { name: '投递联系人' }).click();
    await editor.getByRole('checkbox', { name: /妈妈/ }).check();
    await f.page.keyboard.press('Escape');
    await editor.getByRole('button', { name: '核对投递并保存' }).click();
    const review = f.page.getByRole('dialog', { name: '核对投递摘要' });
    await review.waitFor();
    assert.equal(f.writes.filter((write) => write.path === '/letter').length, 0);
    assert.match(await review.textContent(), /账号创建时间/);
    assert.match(await review.textContent(), /family@example.test/);
    assert.match(await review.textContent(), /30 天/);
    assert.equal(await review.getByRole('button', { name: '确认并保存' }).isDisabled(), true);
    assert.equal(
      JSON.stringify(await storedDraft(f.page)).includes('mock-reviewed-payload'),
      false,
    );
    await review.getByRole('checkbox', { name: '我已知晓启用后可能立即投递' }).check();
    await review.getByRole('button', { name: '确认并保存' }).click();
    await review.waitFor({ state: 'detached' });
    const saved = f.writes.find((write) => write.path === '/letter');
    assert.equal(saved.body.deliveryPreviewToken, 'mock-reviewed-payload');
    assert.equal(saved.body.deliveryEnabled, true);
    assert.equal(await storedDraft(f.page), null);
  } finally {
    await f.close();
  }
});

test('review blockers and failed saves leave editable recovery data instead of silently enabling delivery', async () => {
  const f = await fixture();
  f.reviewState.blockers = ['请先完成 SMTP 配置。'];
  try {
    await visit(f.page, '/letters');
    const editor = await fillLetter(f.page);
    await editor.getByLabel('开启离线自动投递').check();
    await editor.getByLabel('离线触发时间（分钟）').fill('1440');
    await editor.getByRole('button', { name: '核对投递并保存' }).click();
    const review = f.page.getByRole('dialog', { name: '核对投递摘要' });
    await review.waitFor();
    assert.equal(await review.getByRole('button', { name: '确认并保存' }).isDisabled(), true);
    await review.getByRole('button', { name: '返回编辑' }).click();
    await editor.getByLabel('开启离线自动投递').uncheck();
    f.failLetters();
    await editor.getByRole('button', { name: '创建信件', exact: true }).click();
    await editor.getByRole('alert').waitFor();
    assert.equal(await editor.getByLabel('标题', { exact: true }).inputValue(), '尚未提交的长信');
    assert.equal((await storedDraft(f.page)).draft.deliveryEnabled, false);
  } finally {
    await f.close();
  }
});

test('stale recovered edits become disabled new drafts without overwriting newer letters, and logout removes private recovery data', async () => {
  const f = await fixture();
  try {
    await visit(f.page, '/letters');
    await f.page.getByRole('button', { name: '继续写', exact: true }).click();
    const editor = f.page.getByRole('dialog', { name: '编辑信件', exact: true });
    await editor.getByLabel('标题', { exact: true }).fill('仍需保留的旧版本修改');
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    await f.page.getByRole('button', { name: '保留草稿并关闭', exact: true }).click();
    f.letterData[0].updatedAt = new Date(Date.now() + 1000).toISOString();
    await f.page.reload();
    await f.page.getByRole('button', { name: '作为新信恢复' }).click();
    const recovered = f.page.getByRole('dialog', { name: '新建信件', exact: true });
    assert.equal(
      await recovered.getByLabel('标题', { exact: true }).inputValue(),
      '仍需保留的旧版本修改',
    );
    assert.equal(await recovered.getByLabel('开启离线自动投递').isChecked(), false);
    assert.equal((await storedDraft(f.page)).editingUuid, null);
    assert.equal((await storedDraft(f.page)).draft.expectedUpdatedAt, undefined);
    assert.equal(f.writes.length, 0);
    await recovered.getByRole('button', { name: '取消', exact: true }).click();
    await f.page.getByRole('button', { name: '保留草稿并关闭', exact: true }).click();
    await f.page.getByRole('button', { name: '退出登录', exact: true }).click();
    await f.page.getByRole('textbox', { name: '邮箱', exact: true }).waitFor();
    assert.equal(await storedDraft(f.page), null);
  } finally {
    await f.close();
  }
});

test('browser storage failure is visible and closing cannot pretend the draft was protected', async () => {
  const f = await fixture();
  try {
    await f.page.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('after-life-letter-draft-v1:'))
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return setItem.call(this, key, value);
      };
    });
    await visit(f.page, '/letters');
    const editor = await fillLetter(f.page);
    assert.match(await editor.getByRole('status').textContent(), /无法保存恢复草稿/);
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    const close = f.page.getByRole('dialog', { name: '保留尚未提交的修改？' });
    assert.equal(await close.getByRole('button', { name: '保留草稿并关闭' }).count(), 0);
    await close.getByRole('button', { name: '继续写', exact: true }).click();
    assert.match(await editor.getByRole('textbox', { name: '信件正文' }).textContent(), /能够恢复/);
  } finally {
    await f.close();
  }
});

test('long letters, preview and delivery review fit phone screens and reduced keyboard-height viewports', async () => {
  for (const width of [320, 390, 768]) {
    const f = await fixture({ width });
    try {
      await visit(f.page, '/letters');
      const editor = await fillLetter(f.page);
      await editor.getByRole('textbox', { name: '信件正文' }).fill('长内容'.repeat(500));
      await editor.getByRole('button', { name: '预览正文', exact: true }).click();
      const preview = f.page.getByRole('dialog', { name: '信件完整预览' });
      await preview.waitFor();
      await capture(f.page, 'letter-preview-' + width);
      await preview.getByRole('button', { name: '返回编辑' }).click();
      await f.page.setViewportSize({ width, height: 420 });
      const save = editor.getByRole('button', { name: '创建信件', exact: true });
      const bounds = await save.boundingBox();
      assert.ok(
        bounds.y >= 0 && bounds.y + bounds.height <= 420,
        'Save remains visible above a simulated keyboard',
      );
      assert.ok(
        await editor.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
        'Composer must not overflow horizontally',
      );
      await f.page.screenshot({
        path: join(screenshots, 'letter-keyboard-' + width + '.png'),
        animations: 'disabled',
      });
      await f.page.setViewportSize({ width, height: 900 });
      await editor.getByLabel('开启离线自动投递').check();
      await editor.getByLabel('离线触发时间（分钟）').fill('43200');
      await editor.getByRole('button', { name: '投递联系人' }).click();
      await editor.getByRole('checkbox', { name: /妈妈/ }).check();
      await f.page.keyboard.press('Escape');
      await editor.getByRole('button', { name: '核对投递并保存' }).click();
      const review = f.page.getByRole('dialog', { name: '核对投递摘要' });
      await review.waitFor();
      assert.ok(await review.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
      await capture(f.page, 'letter-delivery-review-' + width);
    } finally {
      await f.close();
    }
  }
});

test('palette keeps text readable and interactive boundaries distinct on dark surfaces', async () => {
  const f = await fixture();
  try {
    await visit(f.page, '/ui-kit');
    const ratios = await f.page.evaluate(() => {
      const probe = document.createElement('span');
      probe.hidden = true;
      document.body.append(probe);
      function luminance(token) {
        probe.style.color = 'hsl(var(--' + token + '))';
        const channels = getComputedStyle(probe)
          .color.match(/[0-9.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const srgb = value / 255;
            return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      }
      const pairs = [
        ['Body', 'foreground', 'background', 4.5],
        ['Panel', 'foreground', 'card', 4.5],
        ['Popover', 'foreground', 'popover', 4.5],
        ['Secondary text', 'muted-foreground', 'card', 4.5],
        ['Secondary popover text', 'muted-foreground', 'popover', 4.5],
        ['Primary action', 'primary-foreground', 'primary', 4.5],
        ['Primary hover', 'primary-foreground', 'primary-hover', 4.5],
        ['Selected item', 'accent', 'surface-selected', 4.5],
        ['Error', 'destructive', 'popover', 4.5],
        ['Success', 'success', 'popover', 4.5],
        ['Warning', 'warning', 'popover', 4.5],
        ['Input boundary', 'input', 'popover', 3],
        ['Focus indicator', 'ring', 'background', 3],
      ];
      const result = pairs.map(([name, foreground, background, minimum]) => {
        const light = luminance(foreground);
        const dark = luminance(background);
        return {
          name,
          minimum,
          ratio: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
        };
      });
      probe.remove();
      return result;
    });
    for (const { name, ratio, minimum } of ratios)
      assert.ok(
        ratio >= minimum,
        name + ' contrast ' + ratio.toFixed(2) + ':1 must meet ' + minimum + ':1',
      );
    console.log(
      'Minimum text contrast: ' +
        Math.min(
          ...ratios.filter((item) => item.minimum === 4.5).map((item) => item.ratio),
        ).toFixed(2) +
        ':1',
    );
  } finally {
    await f.close();
  }
});

test('component keyboard, labels, busy controls, focus trapping and reduced motion contracts', async () => {
  const f = await fixture({ admin: true });
  try {
    await visit(f.page, '/ui-kit');
    const invalid = f.page.getByLabel('邮箱示例', { exact: true });
    assert.equal(await invalid.getAttribute('aria-invalid'), 'true');
    const described = await invalid.getAttribute('aria-describedby');
    assert.match(await f.page.locator('[id="' + described + '"]').textContent(), /有效的邮箱/);
    assert.equal(await f.page.getByRole('button', { name: '处理中' }).isDisabled(), true);
    await f.page.getByRole('link', { name: '禁用链接' }).click({ force: true });
    assert.equal(new URL(f.page.url()).pathname, '/ui-kit');
    await f.page.getByRole('switch').check();
    assert.equal(await f.page.getByRole('switch').isChecked(), true);
    await capture(f.page, 'ui-kit');
    await f.page.getByRole('tab', { name: '控件与表单' }).focus();
    await f.page.keyboard.press('ArrowRight');
    assert.equal(
      await f.page.getByRole('tab', { name: '反馈与动画' }).getAttribute('aria-selected'),
      'true',
    );
    await f.page.getByRole('button', { name: '打开弹窗', exact: true }).click();
    const modal = f.page.getByRole('dialog', { name: '编辑示例' });
    await modal.waitFor();
    for (let i = 0; i < 8; i++) {
      await f.page.keyboard.press('Tab');
      assert.equal(await modal.evaluate((el) => el.contains(document.activeElement)), true);
    }
    await f.page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached' });
    assert.equal(
      await f.page
        .getByRole('button', { name: '打开弹窗', exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await f.page.getByRole('button', { name: '开始加载演示' }).click();
    await f.page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await f.page
        .getByRole('status', { name: '示例正在加载' })
        .evaluate((el) => getComputedStyle(el).animationName),
      'none',
    );
    await f.page.getByRole('button', { name: '停止加载演示' }).click();
    assert.equal(await f.page.getByRole('status', { name: '示例正在加载' }).count(), 0);
    await f.page.getByRole('tab', { name: '反馈与动画' }).focus();
    await f.page.keyboard.press('End');
    assert.equal(
      await f.page.getByRole('tab', { name: '数据与布局' }).getAttribute('aria-selected'),
      'true',
    );
    assert.equal(await f.page.getByRole('region', { name: '组件示例信件列表' }).count(), 1);
  } finally {
    await f.close();
  }
});

test('all personal and administrative screens adapt to desktop, tablet and 320px phones', async () => {
  const f = await fixture({ admin: true });
  try {
    for (const width of [1440, 768, 320]) {
      await f.page.setViewportSize({ width, height: 1000 });
      for (const path of [
        '/',
        '/letters',
        '/contacts',
        '/checkin',
        '/profile',
        '/admin',
        '/mail',
        '/settings',
        '/users',
        '/roles',
        '/mcp-settings',
        '/ui-kit',
      ]) {
        await visit(f.page, path);
        await noOverflow(f.page);
      }
    }
    await f.page.setViewportSize({ width: 390, height: 844 });
    await visit(f.page, '/letters');
    await capture(f.page, 'mobile-letters');
    await f.page.getByRole('button', { name: '打开导航' }).click();
    const nav = f.page.getByRole('dialog', { name: 'AFTER LIFE' });
    await nav.getByRole('link', { name: /联系人/ }).click();
    await nav.waitFor({ state: 'detached' });
    assert.equal(new URL(f.page.url()).pathname, '/contacts');
    await f.page.waitForFunction(
      () => document.querySelector('main h1') === document.activeElement,
    );
    await capture(f.page, 'mobile-contacts');
    await f.page.setViewportSize({ width: 1440, height: 1000 });
    await visit(f.page, '/');
    await capture(f.page, 'overview');
    await visit(f.page, '/checkin');
    await capture(f.page, 'checkin');
  } finally {
    await f.close();
  }
});

test('failed profile saves retain input and failed check-ins display feedback without uncaught errors', async () => {
  const f = await fixture({ checkedIn: false });
  try {
    await visit(f.page, '/profile');
    await f.page.getByLabel('用户名', { exact: true }).fill('保留这次编辑');
    f.failOperations();
    await f.page.getByRole('button', { name: '保存资料', exact: true }).click();
    await f.page.getByRole('alert').waitFor();
    assert.equal(await f.page.getByLabel('用户名', { exact: true }).inputValue(), '保留这次编辑');
    await f.page.getByRole('button', { name: '关闭提示' }).click();
    await visit(f.page, '/checkin');
    await f.page.getByRole('button', { name: '立即签到', exact: true }).click();
    await f.page.getByRole('alert').waitFor();
    assert.match(await f.page.getByRole('alert').textContent(), /稍后重试/);
  } finally {
    await f.close();
  }
});

test('empty states and ordinary-user administration guards stay intact', async () => {
  const f = await fixture({ empty: true, width: 390 });
  try {
    await visit(f.page, '/letters');
    assert.equal(await f.page.getByText('还没有信件', { exact: true }).count(), 1);
    await f.page.getByRole('button', { name: '写第一封信' }).click();
    await f.page.keyboard.press('Escape');
    await visit(f.page, '/contacts');
    assert.equal(await f.page.getByText('还没有联系人', { exact: true }).count(), 1);
    for (const path of ['/admin', '/mail', '/settings', '/users', '/roles']) {
      await visit(f.page, path);
      await f.page.waitForURL(origin + '/');
    }
    assert.equal(f.writes.length, 0, 'Read-only navigation must not mutate data');
  } finally {
    await f.close();
  }
});

test('application dropdowns share themed menus, keyboard controls and disabled states on desktop and phones', async () => {
  for (const width of [1440, 320]) {
    const f = await fixture({ admin: true, width });
    const setup = await fixture({ authenticated: false, unconfigured: true, width });
    try {
      await visit(f.page, '/mcp-settings');
      const lifetime = f.page.getByRole('combobox', { name: '有效期' });
      await lifetime.focus();
      await f.page.keyboard.press('Space');
      await f.page.getByRole('listbox').waitFor();
      await f.page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'option');
      await f.page.keyboard.press('End');
      await f.page.waitForFunction(() => document.activeElement?.textContent === '永久');
      await f.page.keyboard.press('Enter');
      assert.equal(await lifetime.textContent(), '永久');
      await lifetime.click();
      await f.page.getByRole('option', { name: '永久', exact: true }).waitFor();
      assert.equal(
        await f.page
          .getByRole('option', { name: '永久', exact: true })
          .getAttribute('aria-selected'),
        'true',
      );
      await noOverflow(f.page);
      await f.page.screenshot({
        path: join(screenshots, `mcp-select-${width}.png`),
        fullPage: false,
        animations: 'disabled',
      });
      await f.page.keyboard.press('Escape');
      await f.page.getByRole('listbox').waitFor({ state: 'detached' });
      await f.page.waitForFunction(
        () => document.activeElement?.getAttribute('aria-label') === '有效期',
      );
      assert.equal(await lifetime.evaluate((element) => element === document.activeElement), true);
      const permissionStyle = await f.page.getByLabel(/^读取信件/).evaluate((element) => ({
        color: getComputedStyle(element).accentColor,
        radius: getComputedStyle(element.closest('label')).borderRadius,
      }));
      assert.equal(permissionStyle.radius, '0px');
      assert.equal(await f.page.locator('select:not([aria-hidden="true"])').count(), 0);

      await visit(f.page, '/mail');
      const secure = f.page.getByRole('combobox', { name: '安全连接' });
      await secure.click();
      await f.page.getByRole('option', { name: '关闭（常用于 587）', exact: true }).click();
      assert.equal(await secure.textContent(), '关闭（常用于 587）');
      await noOverflow(f.page);
      assert.equal(f.writes.length, 0, 'Selecting options must not submit a form');
      assert.equal(await f.page.locator('select:not([aria-hidden="true"])').count(), 0);

      await visit(f.page, '/checkin');
      const warning = f.page.getByRole('combobox', { name: '信件提前提醒时间' });
      const warningEnabled = f.page.getByLabel('信件即将发送时提醒我', { exact: true });
      assert.equal(
        await warningEnabled.evaluate((element) => getComputedStyle(element).accentColor),
        permissionStyle.color,
      );
      await warningEnabled.uncheck();
      assert.equal(await warning.isDisabled(), true);
      await warningEnabled.check();
      await warning.click();
      await f.page.getByRole('option', { name: '提前 3 小时', exact: true }).click();
      assert.equal(await warning.textContent(), '提前 3 小时');
      await noOverflow(f.page);
      assert.equal(await f.page.locator('select:not([aria-hidden="true"])').count(), 0);

      await setup.page.goto(origin, { waitUntil: 'domcontentloaded' });
      await setup.page.getByLabel('服务端端口').fill('3000');
      const steps = setup.page.getByRole('navigation', { name: '初始化步骤' });
      await steps.getByRole('button', { name: '邮件', exact: true }).click();
      const tls = setup.page.getByRole('combobox', { name: 'SSL/TLS' });
      await tls.click();
      await setup.page.getByRole('option', { name: '开启', exact: true }).click();
      await steps.getByRole('button', { name: '数据库', exact: true }).click();
      await steps.getByRole('button', { name: '邮件', exact: true }).click();
      assert.equal(await tls.textContent(), '开启', 'Setup selections survive changing steps');
      await noOverflow(setup.page);
      assert.equal(await setup.page.locator('select:not([aria-hidden="true"])').count(), 0);
      assert.equal(setup.writes.length, 0);
      assert.equal(f.writes.length, 0);
    } finally {
      await f.close();
      await setup.close();
    }
  }
});

test('AI access shows explicit risks, one-time credentials, human approval and revocation on desktop and mobile', async () => {
  const f = await fixture();
  try {
    await visit(f.page, '/mcp-settings');
    await f.page.getByRole('heading', { name: '新建 agent 授权' }).waitFor();
    await f.page.getByText('日常助手', { exact: true }).first().waitFor();
    const checkIn = f.page.getByLabel(/根据人类交互辅助签到/);
    const delivery = f.page.getByLabel(/管理检测与自动投递/);
    assert.equal(await checkIn.isChecked(), false);
    assert.equal(await delivery.isChecked(), false);
    await noOverflow(f.page);
    await capture(f.page, 'mcp-desktop');
    await f.page.getByLabel('授权名称').fill('我的新助手');
    const lifetime = f.page.getByRole('combobox', { name: '有效期' });
    assert.equal(await lifetime.textContent(), '30 天');
    await lifetime.click();
    await f.page.getByRole('option', { name: '永久', exact: true }).click();
    await f.page.getByRole('button', { name: '协助编辑', exact: true }).click();
    assert.equal(await checkIn.isChecked(), false);
    await f.page.getByRole('button', { name: '授权并生成凭证' }).click();
    const secret = f.page.getByRole('dialog', { name: '保存接入凭证' });
    await secret.waitFor();
    assert.equal(await secret.getByLabel('接入凭证').inputValue(), 'mock-one-time-mcp-token');
    await secret.getByRole('button', { name: '已保存，关闭' }).click();
    await secret.waitFor({ state: 'detached' });
    assert.equal(await f.page.locator('textarea').count(), 0);
    const permanentGrant = f.page
      .locator('.mcp-grant')
      .filter({ has: f.page.getByRole('heading', { name: '我的新助手' }) });
    await permanentGrant.getByText(/到期：永久/).waitFor();
    await f.page.getByRole('button', { name: '核对并确认' }).click();
    const review = f.page.getByRole('dialog', { name: '核对即将启用的信件' });
    await review.waitFor();
    assert.match(await review.innerText(), /family@example.test/);
    assert.match(await review.innerText(), /给家人的说明.pdf/);
    await review.getByRole('button', { name: '我已核对，允许启用' }).click();
    await review.waitFor({ state: 'detached' });
    await f.page.getByRole('button', { name: '撤销全部', exact: true }).click();
    await f.page
      .getByRole('dialog', { name: '撤销授权' })
      .getByRole('button', { name: '确认撤销' })
      .click();
    await f.page.getByText('尚未创建授权。').waitFor();
    await f.page.setViewportSize({ width: 320, height: 1000 });
    await noOverflow(f.page);
    await capture(f.page, 'mcp-mobile');
    const created = f.writes.find(
      (write) => write.path === '/mcp-settings/grants' && write.method === 'POST',
    );
    assert.equal(created.body.scopes.includes('mcp:check-in:write'), false);
    assert.equal(created.body.scopes.includes('mcp:delivery:write'), false);
    assert.equal(created.body.days, null);
    assert(
      f.writes.some(
        (write) => write.path === '/mcp-settings/approvals/approval-demo' && write.body.approve,
      ),
    );
  } finally {
    await f.close();
  }
});

test('failed initialization shows an actionable error, preserves the wizard and permits a corrected retry', async () => {
  const f = await fixture({ authenticated: false, unconfigured: true });
  const submissions = [];
  let checksAfterFailure = 0;
  f.page.on('request', (request) => {
    if (submissions.length === 1 && new URL(request.url()).pathname === '/api/setup/status')
      checksAfterFailure++;
  });
  await f.page.route('**/api/setup', async (route) => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1)
      return route.fulfill({
        status: 400,
        json: {
          statusCode: 400,
          message: '数据库认证失败，请检查用户名、密码及该账号的访问权限。',
        },
      });
    return route.fulfill({ json: { data: { initialized: true } } });
  });
  try {
    await f.page.goto(origin, { waitUntil: 'domcontentloaded' });
    await f.page.getByRole('heading', { name: '部署初始化向导' }).waitFor();
    await f.page.getByLabel('服务端端口').fill('3000');
    await f.page.getByRole('button', { name: '下一步', exact: true }).click();
    await f.page.getByLabel('数据库用户').fill('incorrect-user');
    await f.page.getByLabel('数据库密码').fill('test-database-password');
    await f.page.getByRole('button', { name: '下一步', exact: true }).click();
    await f.page.getByRole('button', { name: '下一步', exact: true }).click();
    await f.page.getByLabel('管理员名称').fill('Admin');
    await f.page.getByLabel('管理员邮箱').fill('admin@example.test');
    await f.page.getByLabel('管理员密码').fill('test-admin-password');
    await f.page.getByRole('button', { name: '下一步', exact: true }).click();
    await f.page.getByLabel('账户名称').fill('Alice');
    await f.page.getByLabel('登录邮箱').fill('alice@example.test');
    await f.page.getByLabel('登录密码').fill('test-user-password');
    await f.page.getByLabel('确认密码').fill('test-user-password');
    await f.page.getByRole('button', { name: '完成初始化', exact: true }).click();
    await f.page.getByText('数据库认证失败，请检查用户名、密码及该账号的访问权限。').waitFor();
    await f.page.getByRole('button', { name: '完成初始化', exact: true }).waitFor();
    assert.equal(await f.page.getByLabel('账户名称').inputValue(), 'Alice');
    assert.equal(await f.page.getByLabel('登录密码').inputValue(), 'test-user-password');
    assert(checksAfterFailure > 0, 'Failed submissions refresh actual server lifecycle state');
    const steps = f.page.getByRole('navigation', { name: '初始化步骤' });
    await steps.getByRole('button', { name: '数据库', exact: true }).click();
    assert.equal(await f.page.getByLabel('数据库密码').inputValue(), 'test-database-password');
    await f.page.getByLabel('数据库用户').fill('corrected-user');
    await steps.getByRole('button', { name: '日常账户', exact: true }).click();
    await f.page.getByRole('button', { name: '完成初始化', exact: true }).click();
    await f.page.getByRole('heading', { name: '初始化已完成' }).waitFor();
    assert.equal(submissions.length, 2);
    assert.equal(submissions[1].DB_USER, 'corrected-user');
    assert.equal(submissions[1].INIT_ADMIN_PASSWORD, 'test-admin-password');
    assert.equal(submissions[1].initialUser.password, 'test-user-password');
  } finally {
    await f.close();
  }
});

test('a partially connected database check with an error never shows success', async () => {
  const f = await fixture({ authenticated: false, unconfigured: true });
  await f.page.route('**/api/setup/database/check', (route) =>
    route.fulfill({
      json: { data: { connected: true, error: '数据库权限不足，请检查读写权限。' } },
    }),
  );
  try {
    await f.page.goto(origin, { waitUntil: 'domcontentloaded' });
    await f.page.getByRole('heading', { name: '部署初始化向导' }).waitFor();
    await f.page.getByLabel('服务端端口').fill('3000');
    await f.page.getByRole('button', { name: '下一步', exact: true }).click();
    await f.page.getByRole('button', { name: '测试连接', exact: true }).click();
    await f.page.getByText('数据库权限不足，请检查读写权限。').waitFor();
    assert.equal(await f.page.getByText('数据库连接测试通过。').count(), 0);
  } finally {
    await f.close();
  }
});

test('a visitor can register a personal account and return to login', async () => {
  const f = await fixture({ authenticated: false });
  try {
    await f.page.goto(origin);
    await f.page.getByRole('button', { name: '创建账户' }).click();
    await f.page.getByLabel('账户名称').fill('Alice');
    await f.page.getByRole('textbox', { name: '邮箱', exact: true }).fill('alice@example.test');
    await f.page.locator('input[name=password]').fill('new-user-password');
    await f.page.getByRole('button', { name: '注册账户' }).click();
    await f.page.getByRole('heading', { name: '登录 After Life' }).waitFor();
    assert.deepEqual(f.writes.find(({ path }) => path === '/user')?.body, {
      username: 'Alice',
      email: 'alice@example.test',
      password: 'new-user-password',
    });
    assert.equal(
      await f.page.getByRole('textbox', { name: '邮箱', exact: true }).inputValue(),
      'alice@example.test',
    );
  } finally {
    await f.close();
  }
});
