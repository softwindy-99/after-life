import { McpPermissions1730000000000 } from './1730000000000-McpPermissions';

describe('MCP permissions migration', () => {
  it('extends an existing database with composite owner keys matching BaseTable', async () => {
    const runner = {
      addColumn: jest.fn(),
      hasColumn: jest.fn().mockResolvedValue(false),
      getTable: jest.fn().mockResolvedValue({ indices: [] }),
      createIndex: jest.fn(),
      hasTable: jest.fn().mockResolvedValue(false),
      createTable: jest.fn(),
    };
    await new McpPermissions1730000000000().up(runner as any);
    expect(runner.addColumn).toHaveBeenCalledTimes(5);
    const table = runner.createTable.mock.calls[0][0];
    expect(table.primaryColumns.map((column: { name: string }) => column.name)).toEqual([
      'id',
      'uuid',
    ]);
    expect(table.foreignKeys[0].columnNames).toEqual(['userId', 'userUuid']);
    expect(table.foreignKeys[0].referencedColumnNames).toEqual(['id', 'uuid']);
  });
  it('does not duplicate schema already created by the current initial baseline', async () => {
    const runner = {
      addColumn: jest.fn(),
      hasColumn: jest.fn().mockResolvedValue(true),
      getTable: jest
        .fn()
        .mockResolvedValue({ indices: [{ isUnique: true, columnNames: ['eventKey'] }] }),
      createIndex: jest.fn(),
      hasTable: jest.fn().mockResolvedValue(true),
      createTable: jest.fn(),
    };
    await new McpPermissions1730000000000().up(runner as any);
    expect(runner.addColumn).not.toHaveBeenCalled();
    expect(runner.createTable).not.toHaveBeenCalled();
    expect(runner.createIndex).not.toHaveBeenCalled();
  });
  it('reverts the actual unique index name on both fresh and upgraded databases', async () => {
    const runner = {
      dropTable: jest.fn(),
      getTable: jest.fn().mockResolvedValue({
        indices: [{ name: 'baseline_generated_index', isUnique: true, columnNames: ['eventKey'] }],
      }),
      dropIndex: jest.fn(),
      dropColumn: jest.fn(),
    };
    await new McpPermissions1730000000000().down(runner as any);
    expect(runner.dropIndex).toHaveBeenCalledWith('check_in', 'baseline_generated_index');
  });
});
