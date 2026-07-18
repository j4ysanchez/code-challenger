import { z } from 'zod';

export const LANGUAGES = ['python', 'javascript'] as const;

export const languageSchema = z.enum(LANGUAGES);

export type Language = z.infer<typeof languageSchema>;

/** Runtime version pinned per sandbox image (research.md R10). */
export const LANGUAGE_VERSIONS: Readonly<Record<Language, string>> = {
  python: '3.12',
  javascript: '22',
};

export const VERDICTS = [
  'accepted',
  'wrong_answer',
  'time_limit_exceeded',
  'memory_limit_exceeded',
  'runtime_error',
  'compile_error',
  'system_error',
] as const;

export const verdictSchema = z.enum(VERDICTS);

export type Verdict = z.infer<typeof verdictSchema>;

export const SUBMISSION_STATUSES = ['queued', 'running', 'complete'] as const;

export const submissionStatusSchema = z.enum(SUBMISSION_STATUSES);

export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;

export const PROBLEM_STATUSES = ['draft', 'published'] as const;

export const problemStatusSchema = z.enum(PROBLEM_STATUSES);

export type ProblemStatus = z.infer<typeof problemStatusSchema>;

export const ERROR_CODES = [
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'rate_limited',
  'conflict',
  'internal',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);

export type ErrorCodeValue = z.infer<typeof errorCodeSchema>;

/** Enum-like lookup so call sites can write `ErrorCode.NotFound` instead of a raw string. */
export const ErrorCode: Readonly<Record<string, ErrorCodeValue>> = {
  ValidationFailed: 'validation_failed',
  Unauthorized: 'unauthorized',
  Forbidden: 'forbidden',
  NotFound: 'not_found',
  RateLimited: 'rate_limited',
  Conflict: 'conflict',
  Internal: 'internal',
};

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
