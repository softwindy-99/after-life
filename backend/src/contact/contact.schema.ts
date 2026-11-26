import { z } from 'zod';
import { uuidSchema } from 'src/validation';
const optionalText = (schema: z.ZodString) =>
  z.preprocess((value) => (value === null ? '' : value), schema.optional());
const fields = z
  .object({
    name: z.string().trim().min(1).max(80),
    email: z.preprocess(
      (value) => (value === null ? '' : value),
      z
        .string()
        .trim()
        .toLowerCase()
        .max(100)
        .refine((value) => !value || z.string().email().safeParse(value).success)
        .optional(),
    ),
    phone: optionalText(z.string().trim().max(30)),
    note: optionalText(z.string().trim().max(255)),
    letterUuids: z.array(uuidSchema).max(100).optional(),
  })
  .strict();
export const newContactSchema = fields.refine(
  (value) => Boolean(value.email || value.phone),
  'At least one contact method is required.',
);
export const updateContactSchema = fields
  .partial()
  .extend({ expectedUpdatedAt: z.string().datetime({ offset: true }).optional() })
  .refine((value) => Object.keys(value).length > 0);
