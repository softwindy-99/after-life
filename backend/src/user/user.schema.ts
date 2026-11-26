import { z } from 'zod';
import { emailSchema, passwordSchema, usernameSchema, uuidSchema } from 'src/validation';

const userFields = {
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  avatar: z.string().max(1_000_000).optional(),
};
export const newUserSchema = z.object(userFields).strict();
export const adminNewUserSchema = newUserSchema.extend({ roleUuid: uuidSchema });
export const updateUserSchema = newUserSchema
  .partial()
  .extend({
    avatar: userFields.avatar.nullable(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const adminUpdateUserSchema = newUserSchema
  .partial()
  .extend({
    avatar: userFields.avatar.nullable(),
    roleUuid: uuidSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
const pageNumber = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .pipe(z.coerce.number().int().positive());
export const userListSchema = z
  .object({
    page: pageNumber.pipe(z.number().max(1_000_000)).default(1),
    pageSize: pageNumber.pipe(z.number().max(100)).default(10),
    keyword: z.string().trim().max(100).optional(),
    roleUuid: uuidSchema.optional(),
  })
  .strict();
export const userQuerySchema = z.object({ uuid: uuidSchema.optional() }).strict();
