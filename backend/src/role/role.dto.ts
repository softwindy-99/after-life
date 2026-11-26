import { Role } from './role.entity';
import { toPermissionDto } from 'src/permission/permission.dto';
export function toRoleDto(role: Role) {
  return {
    uuid: role.uuid,
    name: role.name,
    description: role.description,
    permissions: role.permissions
      ?.filter((permission) => permission.iSdelete === 0)
      .map(toPermissionDto),
  };
}
export type RoleDto = ReturnType<typeof toRoleDto>;
