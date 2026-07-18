import {
  LANGUAGES,
  PROBLEM_STATUSES,
  SUBMISSION_STATUSES,
  VERDICTS,
  type Language,
  type ProblemStatus,
  type SubmissionStatus,
  type Verdict,
} from '@code-challenger/contracts';

const includesUnknown = <T extends string>(
  allowlist: readonly T[],
  value: unknown,
): value is T => typeof value === 'string' && (allowlist as readonly string[]).includes(value);

export const isLanguage = (value: unknown): value is Language =>
  includesUnknown(LANGUAGES, value);

export const isVerdict = (value: unknown): value is Verdict =>
  includesUnknown(VERDICTS, value);

export const isSubmissionStatus = (value: unknown): value is SubmissionStatus =>
  includesUnknown(SUBMISSION_STATUSES, value);

export const isProblemStatus = (value: unknown): value is ProblemStatus =>
  includesUnknown(PROBLEM_STATUSES, value);
