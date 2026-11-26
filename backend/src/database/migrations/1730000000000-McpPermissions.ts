import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

export class McpPermissions1730000000000 implements MigrationInterface {
  name = 'McpPermissions1730000000000';

  async up(runner: QueryRunner): Promise<void> {
    const columns = [
      new TableColumn({ name: 'mcpName', type: 'varchar', length: '80', isNullable: true }),
      new TableColumn({ name: 'mcpScopes', type: 'json', isNullable: true }),
      new TableColumn({ name: 'mcpExpiresAt', type: 'datetime', precision: 3, isNullable: true }),
      new TableColumn({ name: 'mcpLastUsedAt', type: 'datetime', precision: 3, isNullable: true }),
    ];
    for (const column of columns)
      if (!(await runner.hasColumn('auth', column.name))) await runner.addColumn('auth', column);
    if (!(await runner.hasColumn('check_in', 'eventKey')))
      await runner.addColumn(
        'check_in',
        new TableColumn({ name: 'eventKey', type: 'varchar', length: '64', isNullable: true }),
      );
    const checkIn = await runner.getTable('check_in');
    if (!checkIn.indices.some((index) => index.isUnique && index.columnNames.includes('eventKey')))
      await runner.createIndex(
        'check_in',
        new TableIndex({
          name: 'IDX_check_in_event_key',
          columnNames: ['eventKey'],
          isUnique: true,
        }),
      );
    if (!(await runner.hasTable('mcp_activity')))
      await runner.createTable(
        new Table({
          name: 'mcp_activity',
          columns: [
            {
              name: 'id',
              type: 'int',
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'increment',
            },
            { name: 'uuid', type: 'varchar', length: '36', isPrimary: true },
            { name: 'createdAt', type: 'datetime', precision: 6, default: 'CURRENT_TIMESTAMP(6)' },
            {
              name: 'updatedAt',
              type: 'datetime',
              precision: 6,
              default: 'CURRENT_TIMESTAMP(6)',
              onUpdate: 'CURRENT_TIMESTAMP(6)',
            },
            { name: 'iSdelete', type: 'int', default: 0 },
            { name: 'authUuid', type: 'varchar', length: '36' },
            { name: 'tool', type: 'varchar', length: '80' },
            { name: 'resourceUuid', type: 'varchar', length: '36', isNullable: true },
            { name: 'outcome', type: 'varchar', length: '16' },
            { name: 'details', type: 'json', isNullable: true },
            { name: 'expiresAt', type: 'datetime', precision: 3, isNullable: true },
            { name: 'userId', type: 'int' },
            { name: 'userUuid', type: 'varchar', length: '36' },
          ],
          indices: [
            {
              name: 'IDX_mcp_activity_user_created',
              columnNames: ['userId', 'userUuid', 'createdAt'],
            },
          ],
          foreignKeys: [
            {
              columnNames: ['userId', 'userUuid'],
              referencedTableName: 'user',
              referencedColumnNames: ['id', 'uuid'],
            },
          ],
        }),
      );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.dropTable('mcp_activity');
    const table = await runner.getTable('check_in');
    const index = table.indices.find(
      (item) => item.isUnique && item.columnNames.includes('eventKey'),
    );
    if (index) await runner.dropIndex('check_in', index.name);
    await runner.dropColumn('check_in', 'eventKey');
    for (const name of ['mcpLastUsedAt', 'mcpExpiresAt', 'mcpScopes', 'mcpName'])
      await runner.dropColumn('auth', name);
  }
}
