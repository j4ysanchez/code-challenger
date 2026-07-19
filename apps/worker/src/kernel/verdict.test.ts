import { describe, expect, it } from 'vitest';
import {
  compareOutput,
  foldSubmissionVerdict,
  mapCaseOutcome,
  mapCompileOutcome,
  normalizeOutput,
  shouldContinueAfterFailure,
} from './verdict.js';

describe('normalizeOutput', () => {
  it('strips trailing spaces/tabs per line', () => {
    expect(normalizeOutput('5 \t\n6\t ')).toBe('5\n6');
  });

  it('treats a trailing newline as equivalent to none', () => {
    expect(normalizeOutput('hello\n')).toBe(normalizeOutput('hello'));
  });

  it('collapses trailing blank lines', () => {
    expect(normalizeOutput('hello\n\n\n')).toBe('hello');
  });

  it('preserves internal blank lines and leading whitespace', () => {
    expect(normalizeOutput('  a\n\nb')).toBe('  a\n\nb');
  });
});

describe('compareOutput', () => {
  it('matches modulo trailing-whitespace normalization', () => {
    expect(compareOutput('5\n', '5')).toBe(true);
    expect(compareOutput('5 \n', '5')).toBe(true);
  });

  it('does not match on different content', () => {
    expect(compareOutput('5', '6')).toBe(false);
  });
});

describe('mapCompileOutcome', () => {
  it('maps a clean exit to ok', () => {
    expect(mapCompileOutcome({ exitCode: 0, signal: null })).toBe('ok');
  });

  it('maps a non-zero exit to compile_error', () => {
    expect(mapCompileOutcome({ exitCode: 1, signal: null })).toBe('compile_error');
  });

  it('maps a signal-terminated compile step to compile_error', () => {
    expect(mapCompileOutcome({ exitCode: null, signal: 'SIGKILL' })).toBe('compile_error');
  });
});

describe('mapCaseOutcome', () => {
  const base = {
    timedOut: false,
    oomKilled: false,
    outputCapped: false,
    exitCode: 0,
    signal: null,
    matches: true,
  };

  it('maps a matching clean exit to pass', () => {
    expect(mapCaseOutcome(base)).toBe('pass');
  });

  it('maps a clean exit with mismatched output to wrong_answer', () => {
    expect(mapCaseOutcome({ ...base, matches: false })).toBe('wrong_answer');
  });

  it('maps a non-zero exit to runtime_error', () => {
    expect(mapCaseOutcome({ ...base, exitCode: 1 })).toBe('runtime_error');
  });

  it('maps a signal termination to runtime_error', () => {
    expect(mapCaseOutcome({ ...base, exitCode: null, signal: 'SIGSEGV' })).toBe('runtime_error');
  });

  it('maps a wall/cpu timeout to time_limit_exceeded regardless of exit code', () => {
    expect(mapCaseOutcome({ ...base, timedOut: true, exitCode: null, signal: 'SIGKILL' })).toBe(
      'time_limit_exceeded',
    );
  });

  it('maps an OOM kill to memory_limit_exceeded, taking priority over a plain non-zero exit', () => {
    expect(mapCaseOutcome({ ...base, oomKilled: true, exitCode: 137 })).toBe('memory_limit_exceeded');
  });

  it('maps an exceeded output cap to runtime_error', () => {
    expect(mapCaseOutcome({ ...base, outputCapped: true, matches: false })).toBe('runtime_error');
  });

  it('prioritizes timeout over OOM when both are observed', () => {
    expect(mapCaseOutcome({ ...base, timedOut: true, oomKilled: true })).toBe('time_limit_exceeded');
  });
});

describe('foldSubmissionVerdict', () => {
  it('is accepted when every case passes', () => {
    expect(foldSubmissionVerdict(['pass', 'pass', 'pass'])).toBe('accepted');
  });

  it('is the first non-pass verdict in position order', () => {
    expect(foldSubmissionVerdict(['pass', 'wrong_answer', 'time_limit_exceeded'])).toBe('wrong_answer');
  });

  it('is accepted for an empty case list', () => {
    expect(foldSubmissionVerdict([])).toBe('accepted');
  });
});

describe('shouldContinueAfterFailure', () => {
  it('continues past a visible failure', () => {
    expect(shouldContinueAfterFailure({ visible: true })).toBe(true);
  });

  it('stops early on a hidden failure', () => {
    expect(shouldContinueAfterFailure({ visible: false })).toBe(false);
  });
});
