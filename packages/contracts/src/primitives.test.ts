import { describe, expect, it } from 'vitest';
import {
  ErrorCode,
  errorEnvelopeSchema,
  languageSchema,
  LANGUAGE_VERSIONS,
  problemStatusSchema,
  submissionStatusSchema,
  verdictSchema,
} from './primitives.js';

describe('languageSchema', () => {
  it('accepts every allowlisted language', () => {
    expect(languageSchema.parse('python')).toBe('python');
    expect(languageSchema.parse('javascript')).toBe('javascript');
  });

  it('rejects languages outside the allowlist', () => {
    expect(languageSchema.safeParse('ruby').success).toBe(false);
    expect(languageSchema.safeParse('').success).toBe(false);
  });

  it('declares a runtime version for every allowlisted language', () => {
    expect(LANGUAGE_VERSIONS.python).toBe('3.12');
    expect(LANGUAGE_VERSIONS.javascript).toBe('22');
  });
});

describe('verdictSchema', () => {
  it('accepts every documented verdict', () => {
    const verdicts = [
      'accepted',
      'wrong_answer',
      'time_limit_exceeded',
      'memory_limit_exceeded',
      'runtime_error',
      'compile_error',
      'system_error',
    ];
    for (const verdict of verdicts) {
      expect(verdictSchema.parse(verdict)).toBe(verdict);
    }
  });

  it('rejects unknown verdicts', () => {
    expect(verdictSchema.safeParse('passed').success).toBe(false);
  });
});

describe('submissionStatusSchema', () => {
  it('accepts the queued/running/complete lifecycle', () => {
    expect(submissionStatusSchema.parse('queued')).toBe('queued');
    expect(submissionStatusSchema.parse('running')).toBe('running');
    expect(submissionStatusSchema.parse('complete')).toBe('complete');
  });

  it('rejects any other status', () => {
    expect(submissionStatusSchema.safeParse('done').success).toBe(false);
  });
});

describe('problemStatusSchema', () => {
  it('accepts draft and published', () => {
    expect(problemStatusSchema.parse('draft')).toBe('draft');
    expect(problemStatusSchema.parse('published')).toBe('published');
  });

  it('rejects any other status', () => {
    expect(problemStatusSchema.safeParse('archived').success).toBe(false);
  });
});

describe('errorEnvelopeSchema', () => {
  it('accepts the documented error shape with an allowlisted code', () => {
    const parsed = errorEnvelopeSchema.parse({
      error: { code: 'validation_failed', message: 'email is required' },
    });
    expect(parsed.error.code).toBe('validation_failed');
  });

  it('rejects an error code outside the documented set', () => {
    expect(
      errorEnvelopeSchema.safeParse({
        error: { code: 'teapot', message: 'nope' },
      }).success,
    ).toBe(false);
  });

  it('exposes the same codes as the ErrorCode enum', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(
        errorEnvelopeSchema.safeParse({ error: { code, message: 'x' } })
          .success,
      ).toBe(true);
    }
  });
});
