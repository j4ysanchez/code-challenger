import { err, ok, type Result } from './result.js';

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UserId = Brand<string, 'UserId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type ProblemId = Brand<string, 'ProblemId'>;
export type TestCaseId = Brand<string, 'TestCaseId'>;
export type SubmissionId = Brand<string, 'SubmissionId'>;

const asBrandedUuid = <B extends string>(value: string): Result<Brand<string, B>, 'invalid_uuid'> =>
  UUID_PATTERN.test(value) ? ok(value as Brand<string, B>) : err('invalid_uuid');

export const asUserId = (value: string): Result<UserId, 'invalid_uuid'> =>
  asBrandedUuid<'UserId'>(value);

export const asSessionId = (value: string): Result<SessionId, 'invalid_uuid'> =>
  asBrandedUuid<'SessionId'>(value);

export const asProblemId = (value: string): Result<ProblemId, 'invalid_uuid'> =>
  asBrandedUuid<'ProblemId'>(value);

export const asTestCaseId = (value: string): Result<TestCaseId, 'invalid_uuid'> =>
  asBrandedUuid<'TestCaseId'>(value);

export const asSubmissionId = (value: string): Result<SubmissionId, 'invalid_uuid'> =>
  asBrandedUuid<'SubmissionId'>(value);
