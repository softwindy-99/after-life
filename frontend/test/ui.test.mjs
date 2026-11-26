import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const exports = {};
  cache.set(path, exports);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  runInNewContext(code, {
    exports,
    require(name) {
      if (!name.startsWith('.')) return require(name);
      const base = resolve(dirname(path), name);
      const file = ['.ts', '.tsx', '/index.ts']
        .map((extension) => base + extension)
        .find(existsSync);
      assert.ok(file, name);
      return load(file);
    },
  });
  return exports;
}
const ui = load(new URL('../src/components/ui/index.ts', import.meta.url).pathname);
const render = (component, props, children) =>
  renderToStaticMarkup(React.createElement(component, props, children));

test('buttons do not accidentally submit forms and busy native buttons prevent repeat actions', () => {
  assert.match(render(ui.Button, {}, 'action'), /type="button"/);
  const busy = render(ui.Button, { busy: true, type: 'submit' }, 'save');
  assert.match(busy, /type="submit"/);
  assert.match(busy, /disabled=""/);
  assert.match(busy, /aria-busy="true"/);
  assert.match(
    render(
      ui.Button,
      { asChild: true, disabled: true },
      React.createElement('a', { href: '/letters' }, 'link'),
    ),
    /aria-disabled="true"/,
  );
});

test('Field preserves existing descriptions and links generated error and hint IDs to the control', () => {
  const field = render(
    ui.Field,
    { label: 'Email', hint: 'Hint', error: 'Error' },
    React.createElement(ui.Input, { id: 'email', 'aria-describedby': 'existing' }),
  );
  assert.match(field, /for="email"/);
  assert.match(field, /aria-describedby="existing email-hint email-error"/);
  assert.match(field, /aria-invalid="true"/);
  assert.match(field, /id="email-error" role="alert"/);
});

test('determinate progress is bounded and unknown progress never invents a percentage', () => {
  for (const [value, expected] of [
    [-12, 0],
    [150, 100],
    [NaN, 0],
    [Infinity, 0],
    [64, 64],
  ]) {
    assert.match(
      render(ui.Progress, { label: 'Upload', value }),
      new RegExp('aria-valuenow="' + expected + '"'),
    );
  }
  assert.doesNotMatch(render(ui.Progress, { label: 'Loading' }), /aria-valuenow/);
});

test('tables have named keyboard scroll regions and tabs fall back to the first enabled item', () => {
  assert.match(
    render(ui.Table, { scrollLabel: 'Letters' }),
    /role="region" aria-label="Letters" tabIndex="0"/i,
  );
  const tabs = render(ui.Tabs, {
    value: 'missing',
    label: 'Examples',
    onValueChange() {},
    items: [
      { value: 'disabled', label: 'Disabled', content: 'A', disabled: true },
      { value: 'enabled', label: 'Enabled', content: 'B' },
    ],
  });
  assert.match(tabs, /aria-selected="true" tabindex="0">Enabled/);
  assert.equal((tabs.match(/aria-selected="true"/g) || []).length, 1);
});
