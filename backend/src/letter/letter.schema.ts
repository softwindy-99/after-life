import { z } from 'zod';
import { uuidSchema } from 'src/validation';
const minutes = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .pipe(z.coerce.number().int().min(1).max(2_147_483_647));
const letterFields = z
  .object({
    title: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(100_000),
    contentFormat: z.literal('html').optional(),
    inactiveAfterMinutes: z.preprocess(
      (value) => (value === '' ? null : value),
      minutes.nullable().optional(),
    ),
    deliveryEnabled: z.boolean().optional(),
    contactUuids: z.array(uuidSchema).max(100).optional(),
  })
  .strict();
export const deliveryPreviewSchema = letterFields.extend({
  inactiveAfterMinutes: minutes,
  letterUuid: uuidSchema.optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});
export type DeliveryPreviewInput = z.infer<typeof deliveryPreviewSchema>;
export const newLetterSchema = letterFields.extend({
  deliveryPreviewToken: z.string().max(100).optional(),
});
export type CreateLetterInput = z.infer<typeof newLetterSchema>;
export const updateLetterSchema = newLetterSchema
  .partial()
  .extend({ expectedUpdatedAt: z.string().datetime({ offset: true }).optional() })
  .refine((value) =>
    Object.keys(value).some((key) => !['expectedUpdatedAt', 'deliveryPreviewToken'].includes(key)),
  );
export type UpdateLetterInput = z.infer<typeof updateLetterSchema>;
