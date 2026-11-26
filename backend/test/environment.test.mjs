import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const runner = fileURLToPath(new URL('../../scripts/run-env.mjs', import.meta.url));
for (const [environment, nodeEnv] of [
  ['dev', 'development'],
  ['test', 'test'],
  ['pro', 'production'],
]) {
  test(`launches ${environment} with the matching Node environment and preserves injected values`, () => {
    const output = execFileSync(
      process.execPath,
      [
        runner,
        environment,
        process.execPath,
        '-e',
        'console.log(JSON.stringify([process.env.APP_ENV, process.env.NODE_ENV, process.env.CONFIG_TEST_VALUE]))',
      ],
      {
        env: { ...process.env, APP_ENV: 'wrong', NODE_ENV: 'wrong', CONFIG_TEST_VALUE: 'injected' },
        encoding: 'utf8',
      },
    );
    assert.deepEqual(JSON.parse(output), [environment, nodeEnv, 'injected']);
  });
}
test('propagates command failures', () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [runner, 'pro', process.execPath, '-e', 'process.exit(7)']),
    { status: 7 },
  );
});
