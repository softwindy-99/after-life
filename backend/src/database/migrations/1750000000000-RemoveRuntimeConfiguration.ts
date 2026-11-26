import { MigrationInterface, QueryRunner } from 'typeorm';
import { RuntimeConfiguration1720000000000 } from './1720000000000-RuntimeConfiguration';

export class RemoveRuntimeConfiguration1750000000000 implements MigrationInterface {
  name = 'RemoveRuntimeConfiguration1750000000000';

  async up(runner: QueryRunner): Promise<void> {
    // Export saved settings to the active root env file before applying this migration.
    await runner.dropTable('runtime_configuration', true);
  }

  async down(runner: QueryRunner): Promise<void> {
    // Rollback restores the schema only; deleted configuration requires a backup.
    await new RuntimeConfiguration1720000000000().up(runner);
  }
}
