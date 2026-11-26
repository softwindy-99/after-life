import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const SELF_PERMISSION = 'self';
export const Permission = (...args: string[]) => SetMetadata(PERMISSIONS_KEY, args);
export const Self = () => Permission(SELF_PERMISSION);
