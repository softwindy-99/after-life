import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cli = fileURLToPath(
  new URL('../src/agent/skill/use-after-life/scripts/afterlife.mjs', import.meta.url),
);
const token = 'test-grant-secret';

async function run(args, env = {}, input = '') {
  const child = spawn(process.execPath, [cli, ...args], {
    env: {
      ...process.env,
      AFTERLIFE_TOKEN_FILE: '',
      AFTERLIFE_TOKEN: token,
      AFTERLIFE_SERVER_URL: '',
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(input);
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}

async function serverFor(t, handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    requests.push({ path: req.url, headers: req.headers, body });
    const message = req.url.endsWith('/mcp') ? JSON.parse(body) : undefined;
    res.setHeader('Content-Type', 'application/json');
    if (message?.method === 'initialize') {
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { protocolVersion: '2025-03-26' },
        }),
      );
    } else if (message?.method === 'notifications/initialized') {
      res.writeHead(202).end();
    } else {
      await handler(req, res, message);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return { requests, base: `http://127.0.0.1:${server.address().port}/proxy/api` };
}

test('help/version are offline; invalid flags, URLs and JSON fail before networking', async () => {
  assert.equal((await run(['--help'])).code, 0);
  assert.equal((await run(['--version'])).code, 0);
  for (const args of [
    ['--token', token],
    ['tools', 'extra'],
    ['tools', '--input', '-'],
    ['call', 'afterlife_get_my_profile', '--server', 'https://user:secret@example.com/api'],
    ['tools', '--server', 'http://example.com'],
    ['tools', '--server', 'https://example.com/api/mcp'],
    ['call', 'afterlife_list_letters', '--server', 'http://localhost', '--input', '-'],
  ]) {
    const result = await run(args, {}, '[]');
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes(token));
    assert.ok(!result.stderr.includes('user:secret'));
  }
});

test('discovers paginated schemas and sends stdin input using a token file and proxy prefix', async (t) => {
  const fixture = await serverFor(t, (_req, res, message) => {
    const result =
      message.method === 'tools/list'
        ? {
            tools: [
              {
                name: message.params?.cursor ? 'second' : 'first',
                inputSchema: { type: 'object' },
              },
            ],
            ...(message.params?.cursor ? {} : { nextCursor: 'page-2' }),
          }
        : { structuredContent: { received: message.params.arguments } };
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  const directory = await mkdtemp(join(tmpdir(), 'afterlife-cli-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tokenFile = join(directory, 'token');
  await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });
  const env = {
    AFTERLIFE_SERVER_URL: fixture.base,
    AFTERLIFE_TOKEN: 'wrong',
    AFTERLIFE_TOKEN_FILE: tokenFile,
  };
  const tools = await run(['tools'], env);
  assert.equal(tools.code, 0, tools.stderr);
  assert.deepEqual(
    JSON.parse(tools.stdout).tools.map((tool) => tool.name),
    ['first', 'second'],
  );
  const called = await run(['call', 'afterlife_list_letters', '--input', '-'], env, '{"page":2}');
  assert.equal(called.code, 0, called.stderr);
  assert.deepEqual(JSON.parse(called.stdout), { received: { page: 2 } });
  assert.ok(
    fixture.requests.every(
      (req) => req.path === '/proxy/api/mcp' && req.headers.authorization === `Bearer ${token}`,
    ),
  );
});

test('tool errors fail without retries and redact the configured bearer value', async (t) => {
  let calls = 0;
  const fixture = await serverFor(t, (_req, res, message) => {
    calls++;
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: { isError: true, content: [{ type: 'text', text: `Conflict ${token}` }] },
      }),
    );
  });
  const result = await run(['call', 'afterlife_update_letter'], {
    AFTERLIFE_SERVER_URL: fixture.base,
  });
  assert.equal(result.code, 1);
  assert.equal(calls, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes('Conflict'));
  assert.ok(!result.stderr.includes(token));
});

test('refuses redirects instead of forwarding credentials or replaying a write', async (t) => {
  let calls = 0;
  const fixture = await serverFor(t, (_req, res) => {
    calls++;
    res.writeHead(307, { Location: '/redirected' }).end();
  });
  const result = await run(['call', 'afterlife_create_letter'], {
    AFTERLIFE_SERVER_URL: fixture.base,
  });
  assert.equal(result.code, 1);
  assert.equal(calls, 1);
  assert.equal(fixture.requests.length, 3);
});

test('uploads with a temporary ticket, preserves the proxy prefix and hides the ticket', async (t) => {
  const fixture = await serverFor(t, (req, res, message) => {
    if (message)
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            structuredContent: {
              uploadPath: '/mcp-files',
              multipartField: 'file',
              headers: { Authorization: 'Bearer upload-ticket-secret' },
            },
          },
        }),
      );
    else res.end(JSON.stringify({ data: { uuid: 'resource-created' } }));
  });
  const directory = await mkdtemp(join(tmpdir(), 'afterlife-upload-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'private.txt');
  await writeFile(file, 'private attachment content');
  const result = await run(['upload', file], { AFTERLIFE_SERVER_URL: fixture.base });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { uuid: 'resource-created' });
  assert.ok(!result.stdout.includes('upload-ticket-secret'));
  const uploaded = fixture.requests.at(-1);
  assert.equal(uploaded.path, '/proxy/api/mcp-files');
  assert.equal(uploaded.headers.authorization, 'Bearer upload-ticket-secret');
  assert.ok(uploaded.body.includes('private attachment content'));
  assert.ok(uploaded.body.includes('name="file"'));
});

test('rejects ticket destinations outside the dedicated upload endpoint', async (t) => {
  let destination = 'https://other.example/mcp-files';
  const fixture = await serverFor(t, (_req, res, message) => {
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          structuredContent: {
            uploadPath: destination,
            multipartField: 'file',
            headers: { Authorization: 'Bearer upload-ticket-secret' },
          },
        },
      }),
    );
  });
  const directory = await mkdtemp(join(tmpdir(), 'afterlife-upload-denied-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'private.txt');
  await writeFile(file, 'private');
  for (const path of [
    'https://other.example/mcp-files',
    '//other.example/mcp-files',
    '/../mcp-files',
  ]) {
    destination = path;
    const result = await run(['upload', file], { AFTERLIFE_SERVER_URL: fixture.base });
    assert.equal(result.code, 1);
    assert.ok(!result.stderr.includes('upload-ticket-secret'));
  }
  assert.ok(fixture.requests.every((req) => req.path === '/proxy/api/mcp'));
});
