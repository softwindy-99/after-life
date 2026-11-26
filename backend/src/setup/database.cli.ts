import 'reflect-metadata';
import { DatabaseSetupService } from './database-setup.service';
import { getMissingEnvKeys, loadEnvIntoProcess } from './env';

const commands = new Set(['check', 'init', 'migrate', 'reset', 'seed']);

async function main() {
  const command = process.argv[2];
  // Help and invalid commands must never load configuration or touch the database.
  const usage = `Usage: npm run db -- ${Array.from(commands).join('|')}`;
  if (!command || command === '--help' || command === '-h') {
    console.log(usage);
    console.log('check is read-only; init/migrate/seed write data; reset destroys the database.');
    return;
  }
  if (!commands.has(command)) throw new Error(usage);

  const env = loadEnvIntoProcess();
  const missingKeys = getMissingEnvKeys(env);
  if (missingKeys.length > 0) {
    throw new Error(`Missing required env keys: ${missingKeys.join(', ')}`);
  }

  const databaseSetupService = new DatabaseSetupService();
  let result: unknown;

  switch (command) {
    case 'check':
      result = await databaseSetupService.check(env);
      break;
    case 'init':
      result = await databaseSetupService.initialize(env);
      break;
    case 'migrate':
      result = await databaseSetupService.migrate(env);
      break;
    case 'reset':
      result = await databaseSetupService.reset(env);
      break;
    case 'seed':
      await databaseSetupService.seed(env);
      result = await databaseSetupService.check(env);
      break;
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
