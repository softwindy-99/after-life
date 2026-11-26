import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/hooks/usePersonalLayout.ts', import.meta.url), 'utf8');

function layout({ width, standalone = false, ios = false }) {
  const exports = {};
  const media = {
    matches: standalone || width <= 1080,
    addEventListener() {},
    removeEventListener() {},
  };
  runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    {
      exports,
      require: () => ({ useSyncExternalStore: (_subscribe, snapshot) => snapshot() }),
      window: {
        matchMedia(query) {
          assert.equal(query, '(display-mode: standalone), (max-width: 1080px)');
          return media;
        },
      },
      navigator: { standalone: ios },
    },
  );
  return exports.usePersonalLayout();
}

test('mobile and tablet browser layouts collect administration into its own entry', () => {
  assert.equal(layout({ width: 390 }), true);
  assert.equal(layout({ width: 1080 }), true);
});

test('desktop browsers preserve their existing layout', () => {
  assert.equal(layout({ width: 1081 }), false);
  assert.equal(layout({ width: 1440 }), false);
});

test('installed PWA and iOS home-screen apps use the personal layout', () => {
  assert.equal(layout({ width: 1440, standalone: true }), true);
  assert.equal(layout({ width: 1440, ios: true }), true);
});
