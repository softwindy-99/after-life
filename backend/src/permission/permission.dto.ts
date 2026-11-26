import { Permission } from './permission.entity';
export function toPermissionDto(permission: Permission) {
  return { uuid: permission.uuid, name: permission.name, description: permission.description };
}
export type PermissionDto = ReturnType<typeof toPermissionDto>;
