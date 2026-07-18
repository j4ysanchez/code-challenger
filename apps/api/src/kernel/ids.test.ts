import { describe, expect, it } from 'vitest';
import { asProblemId, asSubmissionId, asUserId } from './ids.js';
import { isOk, isErr } from './result.js';

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('branded id constructors', () => {
  it('accepts a well-formed uuid for each id kind', () => {
    expect(isOk(asUserId(VALID_UUID))).toBe(true);
    expect(isOk(asProblemId(VALID_UUID))).toBe(true);
    expect(isOk(asSubmissionId(VALID_UUID))).toBe(true);
  });

  it('rejects a non-uuid string', () => {
    const result = asUserId('not-a-uuid');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBe('invalid_uuid');
    }
  });

  it('keeps distinct id kinds structurally identical but nominally separate at compile time', () => {
    // runtime check: both wrap the same string value
    const userId = asUserId(VALID_UUID);
    const problemId = asProblemId(VALID_UUID);
    expect(isOk(userId) && userId.value).toBe(VALID_UUID);
    expect(isOk(problemId) && problemId.value).toBe(VALID_UUID);
  });
});
