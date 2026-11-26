import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Permission } from './permission.entity';
import { PermissionService } from './permission.service';
import { createMockRepository } from 'src/test-utils/mock-repository';

describe('PermissionService', () => {
  let service: PermissionService;
  let permissionRepository: ReturnType<typeof createMockRepository>;

  beforeEach(async () => {
    permissionRepository = createMockRepository();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PermissionService,
        {
          provide: getRepositoryToken(Permission),
          useValue: permissionRepository,
        },
      ],
    }).compile();

    service = moduleRef.get(PermissionService);
  });

  it('returns all active permissions', async () => {
    permissionRepository.find.mockResolvedValue([{ name: 'admin' }]);

    await expect(service.findAll()).resolves.toEqual([{ name: 'admin' }]);
    expect(permissionRepository.find).toHaveBeenCalledWith({
      where: { iSdelete: 0 },
      order: { createdAt: 'ASC' },
    });
  });
});
