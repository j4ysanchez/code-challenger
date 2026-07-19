import { z } from 'zod';
import {
  languageSchema,
  submissionStatusSchema,
  verdictSchema,
} from '../primitives.js';
import { codeSchema, isoDateSchema, slugSchema, uuidSchema } from './shared.js';

export const createSubmissionRequestSchema = z.object({
  language: languageSchema,
  source: codeSchema,
});

export const createSubmissionResponseSchema = z.object({
  submission: z.object({
    id: uuidSchema,
    status: z.literal('queued'),
  }),
});

/** Hidden-case failures reveal only position + visibility (FR-008). */
export const firstFailureSchema = z.discriminatedUnion('visible', [
  z
    .object({
      caseIndex: z.number().int().min(0),
      visible: z.literal(true),
      input: z.string(),
      expectedOutput: z.string(),
      actualOutput: z.string(),
    })
    .strict(),
  z
    .object({
      caseIndex: z.number().int().min(0),
      visible: z.literal(false),
    })
    .strict(),
]);

export type FirstFailure = z.infer<typeof firstFailureSchema>;

export const submissionDetailSchema = z.object({
  id: uuidSchema,
  problemSlug: slugSchema,
  language: languageSchema,
  status: submissionStatusSchema,
  verdict: verdictSchema.nullable(),
  testsPassed: z.number().int().min(0).nullable(),
  testsTotal: z.number().int().min(0).nullable(),
  maxRuntimeMs: z.number().int().min(0).nullable(),
  maxMemoryKb: z.number().int().min(0).nullable(),
  createdAt: isoDateSchema,
  completedAt: isoDateSchema.nullable(),
  sourceCode: codeSchema,
  firstFailure: firstFailureSchema.optional(),
});

export type SubmissionDetail = z.infer<typeof submissionDetailSchema>;

export const submissionDetailResponseSchema = z.object({
  submission: submissionDetailSchema,
});

export const submissionSummarySchema = z.object({
  id: uuidSchema,
  language: languageSchema,
  status: submissionStatusSchema,
  verdict: verdictSchema.nullable(),
  testsPassed: z.number().int().min(0).nullable(),
  testsTotal: z.number().int().min(0).nullable(),
  createdAt: isoDateSchema,
});

export type SubmissionSummary = z.infer<typeof submissionSummarySchema>;

export const submissionsHistoryResponseSchema = z.object({
  submissions: z.array(submissionSummarySchema),
});
