import { z } from 'zod';
import { emailSchema, passwordSchema, usernameSchema } from 'src/validation';
import { setupEnvKeys } from './env';

const envValue = z
  .string()
  .max(4096)
  .refine((value) => !/[\r\n\0]/.test(value), 'Configuration values must be single-line strings.');
export const setupPayloadSchema = z
  .object({
    ...Object.fromEntries(setupEnvKeys.map((key) => [key, envValue.optional()])),
    resetDatabase: z.boolean().optional(),
    initialUser: z
      .object({ username: usernameSchema, email: emailSchema, password: passwordSchema })
      .strict()
      .optional(),
  })
  .strict();
