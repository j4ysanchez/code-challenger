import { z } from 'zod';

const byteLength = (value: string): number =>
  new TextEncoder().encode(value).length;

export const emailSchema = z.string().email().max(254);

export const passwordSchema = z.string().min(8).max(128);

export const uuidSchema = z.string().uuid();

export const isoDateSchema = z.string().datetime({ offset: true });

/** Source/starter/draft code: 1 byte - 100 KB, measured in bytes (FR-005). */
export const codeSchema = z
  .string()
  .refine((value) => byteLength(value) >= 1, 'code must not be empty')
  .refine(
    (value) => byteLength(value) <= 100 * 1024,
    'code must be at most 100 KB',
  );

export const slugSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export const titleSchema = z.string().min(1).max(200);

export const tagsSchema = z.array(z.string().max(32)).max(10);

export const difficultySchema = z.enum(['easy', 'medium', 'hard']);

export type Difficulty = z.infer<typeof difficultySchema>;

/** Admin-configurable per-problem resource limits (data-model.md validation rules). */
export const resourceLimitsSchema = z.object({
  cpuTimeLimitMs: z.number().int().min(100).max(10_000),
  wallTimeLimitMs: z.number().int().min(1_000).max(30_000),
  memoryLimitMb: z.number().int().min(32).max(1_024),
});

export type ResourceLimits = z.infer<typeof resourceLimitsSchema>;

/** Test-case fixture text: up to 1 MB each (data-model.md validation rules). */
export const testCaseTextSchema = z.string().max(1_000_000);
