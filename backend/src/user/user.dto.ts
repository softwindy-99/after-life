import { User } from './user.entity';

export function toUserDto(user: User) {
  return {
    uuid: user.uuid,
    username: user.username,
    email: user.email,
    role: user.role
      ? {
          uuid: user.role.uuid,
          name: user.role.name,
          permissions: user.role.permissions
            ?.filter((permission) => permission.iSdelete === 0)
            .map((permission) => ({
              uuid: permission.uuid,
              name: permission.name,
              description: permission.description,
            })),
        }
      : undefined,
  };
}
export type UserDto = ReturnType<typeof toUserDto>;
