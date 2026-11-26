import { spawn } from 'node:child_process';
import { constants } from 'node:os';

const [environment, command, ...args] = process.argv.slice(2);
const nodeEnvironments = { dev: 'development', test: 'test', pro: 'production' };
if (!Object.hasOwn(nodeEnvironments, environment) || !command) {
  throw new Error('Usage: node scripts/run-env.mjs dev|test|pro command [args...]');
}
const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
const child = spawn(executable, args, {
  stdio: 'inherit',
  env: { ...process.env, APP_ENV: environment, NODE_ENV: nodeEnvironments[environment] },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => {
  console.error(`Unable to start ${command}.`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 128 + constants.signals[signal] : 1);
});
