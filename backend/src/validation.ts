import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request input.',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export const usernameSchema = z.string().trim().min(1).max(50);
export const emailSchema = z.string().trim().toLowerCase().email().max(50);
export const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine((value) => Boolean(value.trim()));
export const uuidSchema = z.string().trim().uuid();

export class SchemaPipe<T extends z.ZodTypeAny> {
  constructor(private readonly schema: T) {}

  transform(input: unknown): z.output<T> {
    return parseInput(this.schema, input);
  }
}
