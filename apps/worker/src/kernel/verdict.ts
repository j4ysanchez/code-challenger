import type { Verdict } from '@code-challenger/contracts';

/** Per-test-case outcome; 'accepted' is a submission-level verdict only (folded from case passes). */
export type CaseVerdict = Exclude<Verdict, 'accepted'> | 'pass';

/** Trailing-whitespace-normalized comparison per contracts/sandbox-profile.md: per line and final newline. */
export const normalizeOutput = (value: string): string =>
  value
    .split('\n')
    .map((line) => line.replace(/[ \t\r]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');

export const compareOutput = (actual: string, expected: string): boolean =>
  normalizeOutput(actual) === normalizeOutput(expected);

export interface ExitObservation {
  readonly exitCode: number | null;
  readonly signal: string | null;
}

/** Compile/syntax-check step outcome; a compile failure short-circuits the whole submission. */
export const mapCompileOutcome = (obs: ExitObservation): 'ok' | 'compile_error' =>
  obs.exitCode === 0 && obs.signal === null ? 'ok' : 'compile_error';

export interface CaseRunObservation extends ExitObservation {
  readonly timedOut: boolean;
  readonly oomKilled: boolean;
  readonly outputCapped: boolean;
  readonly matches: boolean;
}

/** Exit-status -> verdict mapping per contracts/sandbox-profile.md, in priority order. */
export const mapCaseOutcome = (obs: CaseRunObservation): CaseVerdict => {
  if (obs.timedOut) {
    return 'time_limit_exceeded';
  }
  if (obs.oomKilled) {
    return 'memory_limit_exceeded';
  }
  if (obs.outputCapped) {
    return 'runtime_error';
  }
  if (obs.exitCode !== 0 || obs.signal !== null) {
    return 'runtime_error';
  }
  return obs.matches ? 'pass' : 'wrong_answer';
};

/** Submission verdict = first non-pass case verdict in position order; accepted if every case passes. */
export const foldSubmissionVerdict = (caseVerdicts: readonly CaseVerdict[]): Verdict => {
  const firstFailure = caseVerdicts.find((verdict): verdict is Exclude<Verdict, 'accepted'> => verdict !== 'pass');
  return firstFailure ?? 'accepted';
};

/**
 * Keeps running subsequent cases after a visible failure (for visible feedback),
 * but stops early once a hidden case fails (contracts/sandbox-profile.md).
 */
export const shouldContinueAfterFailure = (failedCase: { readonly visible: boolean }): boolean =>
  failedCase.visible;
