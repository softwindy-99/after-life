import { ResourceStorage1740000000000 } from './1740000000000-ResourceStorage';

describe('Resource storage migration', () => {
  it('preserves existing resources by defaulting their location to local', async () => {
    const runner = { hasColumn: jest.fn().mockResolvedValue(false), addColumn: jest.fn() };
    await new ResourceStorage1740000000000().up(runner as any);
    expect(runner.addColumn).toHaveBeenCalledWith(
      'resource',
      expect.objectContaining({ name: 'storageDriver', default: "'local'" }),
    );
    expect(runner.addColumn).toHaveBeenCalledWith(
      'resource',
      expect.objectContaining({ name: 'storageTarget', isNullable: true }),
    );
  });

  it('skips columns already created by the baseline and completes partially applied DDL', async () => {
    const runner = { hasColumn: jest.fn().mockResolvedValue(true), addColumn: jest.fn() };
    await new ResourceStorage1740000000000().up(runner as any);
    expect(runner.addColumn).not.toHaveBeenCalled();
    runner.hasColumn.mockImplementation(async (_table, column) => column === 'storageDriver');
    await new ResourceStorage1740000000000().up(runner as any);
    expect(runner.addColumn).toHaveBeenCalledTimes(1);
    expect(runner.addColumn).toHaveBeenCalledWith(
      'resource',
      expect.objectContaining({ name: 'storageTarget' }),
    );
  });

  it('refuses rollback if it would lose external object locations', async () => {
    const runner = { query: jest.fn().mockResolvedValue([{ total: '1' }]), dropColumns: jest.fn() };
    await expect(new ResourceStorage1740000000000().down(runner as any)).rejects.toThrow(
      'external resources',
    );
    expect(runner.dropColumns).not.toHaveBeenCalled();
    runner.query.mockResolvedValue([{ total: '0' }]);
    await new ResourceStorage1740000000000().down(runner as any);
    expect(runner.dropColumns).toHaveBeenCalledWith('resource', ['storageTarget', 'storageDriver']);
  });
});
