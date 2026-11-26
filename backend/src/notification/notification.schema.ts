import { z } from 'zod';
import { uuidSchema } from 'src/validation';
const endpoint = z
  .string()
  .trim()
  .url()
  .max(4096)
  .refine((value) => value.startsWith('https://'));
const preferences = z
  .object({
    dailyReminderEnabled: z.boolean().optional(),
    dailyReminderTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      })
      .optional(),
    letterWarningEnabled: z.boolean().optional(),
    letterWarningMinutes: z.number().int().min(5).max(10080).optional(),
  })
  .strict();
export const subscriptionStatusSchema = z.object({ endpoint }).strict();
export const registerSubscriptionSchema = z
  .object({
    subscription: z
      .object({
        endpoint,
        expirationTime: z.number().nonnegative().nullable().optional(),
        keys: z
          .object({ p256dh: z.string().min(1).max(255), auth: z.string().min(1).max(255) })
          .strict(),
      })
      .strict(),
    preferences: preferences.optional(),
  })
  .strict();
export const updatePreferencesSchema = z.object({ endpoint, preferences }).strict();
export const removeSubscriptionSchema = z
  .object({ endpoint: endpoint.optional(), subscriptionId: uuidSchema.optional() })
  .strict()
  .refine((value) => Boolean(value.endpoint || value.subscriptionId));
