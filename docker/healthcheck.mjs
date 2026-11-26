import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/app/backend/package.json');
const { createConnection } = require('mysql2/promise');
let connection;
try {
  const credentials = JSON.parse(readFileSync('/var/lib/after-life/mysql.json', 'utf8'));
  connection = await createConnection({
    host: '127.0.0.1',
    user: 'after_life',
    password: credentials.password,
    database: 'after_life',
    connectTimeout: 2000,
  });
  await connection.query('SELECT 1');
  const response = await fetch('http://127.0.0.1:3000/api/setup/status', {
    signal: AbortSignal.timeout(3000),
  });
  const status = await response.json();
  if (!response.ok || typeof status.data?.needsSetup !== 'boolean') throw new Error();
  const page = await fetch('http://127.0.0.1:3000/', { signal: AbortSignal.timeout(3000) });
  if (!page.ok || !(await page.text()).includes('<html')) throw new Error();
} catch {
  process.exitCode = 1;
} finally {
  await connection?.end();
}
