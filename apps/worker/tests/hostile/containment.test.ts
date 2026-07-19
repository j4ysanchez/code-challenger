import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Language } from '@code-challenger/contracts';
import { defaultDockerClient, loadSandboxProfile, runInSandbox, type ResourceLimits } from '../../src/platform/docker.js';
import { mapCaseOutcome } from '../../src/kernel/verdict.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE_EXTENSION: Readonly<Record<Language, string>> = {
  python: 'py',
  javascript: 'js',
};

const readFixture = (language: Language, name: string): string =>
  readFileSync(path.join(__dirname, 'fixtures', language, `${name}.${FIXTURE_EXTENSION[language]}`), 'utf8');

const DEFAULT_LIMITS: ResourceLimits = { cpuTimeLimitMs: 2000, wallTimeLimitMs: 3000, memoryLimitMb: 256 };
const LOW_MEMORY_LIMITS: ResourceLimits = { cpuTimeLimitMs: 2000, wallTimeLimitMs: 5000, memoryLimitMb: 64 };

type ExpectedVerdict = 'time_limit_exceeded' | 'memory_limit_exceeded' | 'runtime_error' | 'wrong_answer';

interface HostileCase {
  readonly name: string;
  readonly fixture: string;
  readonly limits: ResourceLimits;
  /** 'contained' = the fork-bomb special case (never a clean pass; see below). */
  readonly expectedVerdict: readonly ExpectedVerdict[] | 'contained';
  readonly expectedOutput?: string;
}

// One row per contracts/sandbox-profile.md's containment acceptance table.
const CASES: readonly HostileCase[] = [
  { name: 'infinite loop', fixture: 'infinite-loop', limits: DEFAULT_LIMITS, expectedVerdict: ['time_limit_exceeded'] },
  { name: 'fork bomb', fixture: 'fork-bomb', limits: DEFAULT_LIMITS, expectedVerdict: 'contained' },
  { name: 'memory bomb', fixture: 'memory-bomb', limits: LOW_MEMORY_LIMITS, expectedVerdict: ['memory_limit_exceeded'] },
  { name: 'filesystem probe', fixture: 'fs-probe', limits: DEFAULT_LIMITS, expectedVerdict: ['runtime_error'] },
  { name: 'network probe', fixture: 'network-probe', limits: DEFAULT_LIMITS, expectedVerdict: ['runtime_error'] },
  {
    name: '100 MB output',
    fixture: 'output-bomb',
    // A slower interpreter may hit the wall-clock kill before streaming 1 MB of
    // output; either outcome proves containment (host protected, output bounded).
    limits: { ...DEFAULT_LIMITS, wallTimeLimitMs: 4000 },
    expectedVerdict: ['runtime_error', 'time_limit_exceeded'],
  },
  {
    name: 'script-injection output',
    fixture: 'script-injection',
    limits: DEFAULT_LIMITS,
    expectedVerdict: ['wrong_answer'],
    expectedOutput: 'safe',
  },
];

describe.each<Language>(['python', 'javascript'])('hostile containment: %s', (language) => {
  const profile = loadSandboxProfile(language);

  it.each(CASES)(
    '$name is contained and mapped to the expected verdict',
    async (testCase) => {
      const startedAt = Date.now();
      const result = await runInSandbox({
        profile,
        command: [...profile.runCommand],
        sourceCode: readFixture(language, testCase.fixture),
        stdin: '',
        limits: testCase.limits,
      });
      const elapsedMs = Date.now() - startedAt;

      // Must complete within wall_time_limit_ms + 5s worker overhead (contracts/sandbox-profile.md).
      expect(elapsedMs).toBeLessThan(testCase.limits.wallTimeLimitMs + 5000);

      if (testCase.expectedVerdict === 'contained') {
        // pids-limit containment: either the wall timer kills a surviving tree, or the
        // bomb's own spawn/fork calls fail and the process exits non-zero — never a clean pass.
        expect(result.timedOut || result.exitCode !== 0).toBe(true);
        return;
      }

      const matches =
        testCase.expectedOutput !== undefined
          ? result.stdout.trim() === testCase.expectedOutput.trim()
          : result.exitCode === 0;

      const verdict = mapCaseOutcome({
        timedOut: result.timedOut,
        oomKilled: result.oomKilled,
        outputCapped: result.outputCapped,
        exitCode: result.exitCode,
        signal: result.signal,
        matches,
      });

      expect(testCase.expectedVerdict).toContain(verdict);

      if (testCase.name === '100 MB output') {
        // stored/streamed output stays capped at 1 MB even though the fixture tries to print far more
        expect(result.stdout.length).toBeLessThanOrEqual(1024 * 1024);
      }

      if (testCase.name === 'script-injection output') {
        // captured as an inert string only — the worker never executes or interprets it
        expect(result.stdout).toContain('<script>alert(1)</script>');
      }
    },
    20_000,
  );
});

describe('host is left unaffected', () => {
  it('leaves no sandbox containers behind after the hostile suite', async () => {
    const docker = defaultDockerClient();
    const containers = await docker.listContainers({
      all: true,
      filters: JSON.stringify({ ancestor: ['sandbox-python312', 'sandbox-node22'] }),
    });
    expect(containers).toHaveLength(0);
  });
});
