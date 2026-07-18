import { z } from 'zod';
import { languageSchema } from '../primitives.js';
import { codeSchema, isoDateSchema } from './shared.js';

export const draftQuerySchema = z.object({
  language: languageSchema,
});

export const draftResponseSchema = z.object({
  draft: z
    .object({
      code: codeSchema,
      updatedAt: isoDateSchema,
    })
    .nullable(),
});

export const draftUpsertRequestSchema = z.object({
  language: languageSchema,
  code: codeSchema,
});
