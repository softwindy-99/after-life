import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class RuntimeConfiguration1720000000000 implements MigrationInterface {
  name = 'RuntimeConfiguration1720000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'runtime_configuration',
        columns: [
          { name: 'id', type: 'int', isPrimary: true },
          { name: 'payload', type: 'longtext', isNullable: false },
        ],
      }),
      true,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('runtime_configuration', true);
  }
}
