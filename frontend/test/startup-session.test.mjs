import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/lib/startup-session.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
function session(localStorage, { cookie = '', protocol = 'http:', denied = false } = {}) {
  const exports = {};
  const writes = [];
  const document = {
    get cookie() {
      if (denied) throw new Error('Cookies denied');
      return cookie;
    },
    set cookie(value) {
      if (denied) throw new Error('Cookies denied');
      writes.push(value);
      cookie = value.includes('Max-Age=0;') ? '' : value.split(';')[0];
    },
  };
  runInNewContext(code, {
    exports,
    document,
    URLSearchParams,
    window: { localStorage, location: { protocol } },
  });
  exports.cookieWrites = writes;
  return exports;
}
const snapshot = {
  needsSetup: true,
  requiresRestart: false,
  initializing: false,
};

test('startup cache retains public lifecycle flags only and the cookie contains no configuration', () => {
  let stored;
  const api = session({
    getItem: () => stored,
    setItem: (_key, value) => {
      stored = value;
    },
  });
  api.rememberStartup({
    ...snapshot,
    values: { JWT_SECRET: 'fake-private-value' },
  });
  assert.deepEqual(JSON.parse(stored), snapshot);
  assert.equal(api.hasPlayedStartup(), true);
  assert.equal(api.cookieWrites[0], 'after-life-startup=1; Path=/; Max-Age=31536000; SameSite=Lax');
  stored = JSON.stringify({
    ...snapshot,
    bootId: 'old-backend-identifier',
    values: { DB_PASSWORD: 'fake-private-value' },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(api.readStartupSnapshot())), snapshot);
});

test('malformed cached flags and unavailable browser persistence fail safely', () => {
  for (const value of [
    '{',
    'null',
    JSON.stringify({ ...snapshot, needsSetup: 'true' }),
    JSON.stringify({ needsSetup: true }),
  ]) {
    assert.equal(session({ getItem: () => value }).readStartupSnapshot(), null);
  }
  const api = session(
    {
      getItem: () => {
        throw new Error('Storage denied');
      },
      setItem: () => {
        throw new Error('Storage denied');
      },
    },
    { denied: true },
  );
  assert.equal(api.readStartupSnapshot(), null);
  assert.equal(api.hasPlayedStartup(), false);
  assert.doesNotThrow(() => api.rememberStartup(snapshot));
  assert.doesNotThrow(() => api.forgetStartup());
});

test('only an exact played cookie skips startup and reset expires it with the same scope', () => {
  for (const cookie of [
    '',
    'after-life-startup=10',
    'other-after-life-startup=1',
    'after-life-startup=false',
  ])
    assert.equal(session({}, { cookie }).hasPlayedStartup(), false);
  const api = session(
    { getItem: () => JSON.stringify(snapshot), setItem() {} },
    { cookie: 'other=1; after-life-startup=1', protocol: 'https:' },
  );
  assert.equal(api.hasPlayedStartup(), true);
  api.forgetStartup();
  assert.equal(api.hasPlayedStartup(), false);
  assert.equal(
    api.cookieWrites[0],
    'after-life-startup=1; Path=/; Max-Age=0; SameSite=Lax; Secure',
  );
  api.rememberStartup(snapshot);
  assert.match(api.cookieWrites[1], /; Secure$/);
});

test('startup debug query accepts play, skip, reset and annotation hold', () => {
  const api = session({});
  for (const mode of ['play', 'skip', 'reset', 'hold'])
    assert.equal(api.readStartupOverride('?other=value&startup=' + mode), mode);
  for (const search of ['', '?startup=true', '?startup=unknown'])
    assert.equal(api.readStartupOverride(search), 'auto');
});
