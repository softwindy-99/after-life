import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class ResourceStorage1740000000000 implements MigrationInterface {
  name = 'ResourceStorage1740000000000';

  async up(runner: QueryRunner): Promise<void> {
    const columns = [
      new TableColumn({ name: 'storageDriver', type: 'varchar', length: '16', default: "'local'" }),
      new TableColumn({ name: 'storageTarget', type: 'varchar', length: '64', isNullable: true }),
    ];
    // 初始迁移使用当前实体建表；全新安装已经具备这些列。
    // The baseline builds current entities, so fresh installs already contain these columns.
    for (const column of columns) {
      if (!(await runner.hasColumn('resource', column.name)))
        await runner.addColumn('resource', column);
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    const remote = await runner.query(
      "SELECT COUNT(*) AS total FROM resource WHERE storageDriver <> 'local'",
    );
    if (Number(remote[0].total)) throw new Error('Cannot revert while external resources exist');
    await runner.dropColumns('resource', ['storageTarget', 'storageDriver']);
  }
}
