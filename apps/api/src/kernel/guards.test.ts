import { describe, expect, it } from 'vitest';
import { isLanguage, isProblemStatus, isSubmissionStatus, isVerdict } from './guards.js';

describe('isLanguage', () => {
  it('accepts allowlisted languages', () => {
    expect(isLanguage('python')).toBe(true);
    expect(isLanguage('javascript')).toBe(true);
  });

  it('rejects anything else, including non-strings', () => {
    expect(isLanguage('ruby')).toBe(false);
    expect(isLanguage(42)).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });
});

describe('isVerdict', () => {
  it('accepts every documented verdict', () => {
    for (const verdict of [
      'accepted',
      'wrong_answer',
      'time_limit_exceeded',
      'memory_limit_exceeded',
      'runtime_error',
      'compile_error',
      'system_error',
    ]) {
      expect(isVerdict(verdict)).toBe(true);
    }
  });

  it('rejects unknown values', () => {
    expect(isVerdict('passed')).toBe(false);
    expect(isVerdict(null)).toBe(false);
  });
});

describe('isSubmissionStatus', () => {
  it('accepts queued/running/complete and rejects anything else', () => {
    expect(isSubmissionStatus('queued')).toBe(true);
    expect(isSubmissionStatus('running')).toBe(true);
    expect(isSubmissionStatus('complete')).toBe(true);
    expect(isSubmissionStatus('done')).toBe(false);
  });
});

describe('isProblemStatus', () => {
  it('accepts draft/published and rejects anything else', () => {
    expect(isProblemStatus('draft')).toBe(true);
    expect(isProblemStatus('published')).toBe(true);
    expect(isProblemStatus('archived')).toBe(false);
  });
});
