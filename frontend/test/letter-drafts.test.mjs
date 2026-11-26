import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = ts.transpileModule(
  readFileSync(new URL('../src/lib/letter-drafts.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;

function fixture() {
  const storage = {};
  Object.defineProperties(storage, {
    getItem: { value: (key) => storage[key] ?? null },
    setItem: {
      value: (key, value) => {
        storage[key] = value;
      },
    },
    removeItem: {
      value: (key) => {
        delete storage[key];
      },
    },
  });
  const exports = {};
  runInNewContext(source, { exports, localStorage: storage });
  return { api: exports, storage };
}
const saved = () => ({
  editingUuid: null,
  savedAt: Date.now(),
  draft: {
    title: 'Private letter',
    content: '<p>Words</p>',
    contentFormat: 'html',
    deliveryEnabled: false,
    inactiveAfterMinutes: '',
    contactUuids: [],
  },
});

test('recovery drafts are isolated by owner and logout clears only private letter drafts', () => {
  const { api, storage } = fixture();
  const original = saved();
  assert.equal(api.writeLetterDraft('owner-a', original), true);
  assert.equal(JSON.stringify(api.readLetterDraft('owner-a')), JSON.stringify(original));
  assert.equal(api.readLetterDraft('owner-b'), null);
  api.writeLetterDraft('owner-b', saved());
  storage['unrelated-preference'] = 'keep';
  api.clearLetterDrafts();
  assert.equal(api.readLetterDraft('owner-a'), null);
  assert.equal(api.readLetterDraft('owner-b'), null);
  assert.equal(storage['unrelated-preference'], 'keep');
});

test('expired and malformed recovery data never becomes an editable draft', () => {
  const { api, storage } = fixture();
  api.writeLetterDraft('expired', { ...saved(), savedAt: Date.now() - 8 * 86400000 });
  assert.equal(api.readLetterDraft('expired'), null);
  for (const draft of [
    null,
    { ...saved().draft, contactUuids: [1] },
    { ...saved().draft, content: 123 },
  ]) {
    api.writeLetterDraft('broken', { ...saved(), draft });
    assert.equal(api.readLetterDraft('broken'), null);
  }
  storage['after-life-letter-draft-v1:json'] = '{invalid';
  assert.equal(api.readLetterDraft('json'), null);
});

test('unavailable persistence reports failure without preventing manual form use', () => {
  const exports = {};
  runInNewContext(source, {
    exports,
    get localStorage() {
      throw new Error('Blocked');
    },
  });
  assert.equal(exports.writeLetterDraft('owner', saved()), false);
  assert.equal(exports.readLetterDraft('owner'), null);
  assert.doesNotThrow(() => exports.clearLetterDrafts());
});
