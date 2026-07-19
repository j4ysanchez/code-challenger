import type { Kysely } from 'kysely';
import type { EvaluationJobPayload, Language, Verdict } from '@code-challenger/contracts';
import { writeAuditEvent } from '../../platform/audit.js';
import type { Database } from '../../platform/db.js';
import { loadSandboxProfile, runInSandbox, type ResourceLimits } from '../../platform/docker.js';
import {
  compareOutput,
  foldSubmissionVerdict,
  mapCaseOutcome,
  mapCompileOutcome,
  shouldContinueAfterFailure,
  type CaseVerdict,
} from '../../kernel/verdict.js';

/** submission_test_results.actual_output is stored only for visible cases, truncated to 4 KB (data-model.md). */
const ACTUAL_OUTPUT_DISPLAY_CAP_BYTES = 4 * 1024;

const truncateForDisplay = (value: string): string => {
  const buffer = Buffer.from(value, 'utf8');
  return buffer.length <= ACTUAL_OUTPUT_DISPLAY_CAP_BYTES
    ? value
    : buffer.subarray(0, ACTUAL_OUTPUT_DISPLAY_CAP_BYTES).toString('utf8');
};

interface CompletionSummary {
  readonly verdict: Verdict;
  readonly testsPassed: number;
  readonly testsTotal: number;
  readonly maxRuntimeMs: number;
  readonly maxMemoryKb: number;
}

/**
 * Consumes one evaluation job: loads the submission and its problem's ordered
 * test cases, runs the compile step (a failure short-circuits the whole
 * submission), then runs each test case in a fresh sandbox — piping stdin,
 * comparing stdout, and persisting a `submission_test_results` row per case
 * (visible cases only get stored output; contracts/sandbox-profile.md). Stops
 * early once a hidden case fails, but keeps running past visible failures so
 * their feedback is still collected. Always finishes by marking the
 * submission complete with a folded verdict and a `submission.completed`
 * audit event.
 */
export const evaluateSubmission = async (db: Kysely<Database>, payload: EvaluationJobPayload): Promise<void> => {
  const submission = await db
    .selectFrom('submissions')
    .selectAll()
    .where('id', '=', payload.submissionId)
    .executeTakeFirst();
  if (!submission) {
    // The submission row is gone (e.g. deleted) — nothing left to evaluate.
    return;
  }

  await db.updateTable('submissions').set({ status: 'running' }).where('id', '=', submission.id).execute();

  const problem = await db
    .selectFrom('problems')
    .select(['cpu_time_limit_ms', 'wall_time_limit_ms', 'memory_limit_mb'])
    .where('id', '=', submission.problem_id)
    .executeTakeFirstOrThrow();

  const testCases = await db
    .selectFrom('test_cases')
    .selectAll()
    .where('problem_id', '=', submission.problem_id)
    .orderBy('position', 'asc')
    .execute();

  const profile = loadSandboxProfile(submission.language as Language);
  const limits: ResourceLimits = {
    cpuTimeLimitMs: problem.cpu_time_limit_ms,
    wallTimeLimitMs: problem.wall_time_limit_ms,
    memoryLimitMb: problem.memory_limit_mb,
  };

  const complete = async (summary: CompletionSummary): Promise<void> => {
    await db
      .updateTable('submissions')
      .set({
        status: 'complete',
        verdict: summary.verdict,
        tests_passed: summary.testsPassed,
        tests_total: summary.testsTotal,
        max_runtime_ms: summary.maxRuntimeMs,
        max_memory_kb: summary.maxMemoryKb,
        completed_at: new Date(),
      })
      .where('id', '=', submission.id)
      .execute();

    await writeAuditEvent(db, {
      eventType: 'submission.completed',
      userId: submission.user_id,
      data: { verdict: summary.verdict, testsPassed: summary.testsPassed, testsTotal: summary.testsTotal },
    });
  };

  if (profile.compileCommand) {
    const compileResult = await runInSandbox({
      profile,
      command: [...profile.compileCommand],
      sourceCode: submission.source_code,
      stdin: '',
      limits,
    });

    if (mapCompileOutcome({ exitCode: compileResult.exitCode, signal: compileResult.signal }) === 'compile_error') {
      await complete({
        verdict: 'compile_error',
        testsPassed: 0,
        testsTotal: testCases.length,
        maxRuntimeMs: compileResult.wallTimeMs,
        maxMemoryKb: compileResult.peakMemoryKb,
      });
      return;
    }
  }

  interface CaseAccumulator {
    readonly caseVerdicts: readonly CaseVerdict[];
    readonly testsPassed: number;
    readonly maxRuntimeMs: number;
    readonly maxMemoryKb: number;
    readonly stopped: boolean;
  }

  const runCase = async (acc: CaseAccumulator, testCase: (typeof testCases)[number]): Promise<CaseAccumulator> => {
    if (acc.stopped) {
      return acc;
    }

    const runResult = await runInSandbox({
      profile,
      command: [...profile.runCommand],
      sourceCode: submission.source_code,
      stdin: testCase.input,
      limits,
    });

    const caseVerdict = mapCaseOutcome({
      timedOut: runResult.timedOut,
      oomKilled: runResult.oomKilled,
      outputCapped: runResult.outputCapped,
      exitCode: runResult.exitCode,
      signal: runResult.signal,
      matches: compareOutput(runResult.stdout, testCase.expected_output),
    });

    await db
      .insertInto('submission_test_results')
      .values({
        submission_id: submission.id,
        test_case_id: testCase.id,
        position: testCase.position,
        passed: caseVerdict === 'pass',
        runtime_ms: runResult.wallTimeMs,
        memory_kb: runResult.peakMemoryKb,
        actual_output: testCase.visible ? truncateForDisplay(runResult.stdout) : null,
      })
      .execute();

    return {
      caseVerdicts: [...acc.caseVerdicts, caseVerdict],
      testsPassed: acc.testsPassed + (caseVerdict === 'pass' ? 1 : 0),
      maxRuntimeMs: Math.max(acc.maxRuntimeMs, runResult.wallTimeMs),
      maxMemoryKb: Math.max(acc.maxMemoryKb, runResult.peakMemoryKb),
      stopped: caseVerdict !== 'pass' && !shouldContinueAfterFailure({ visible: testCase.visible }),
    };
  };

  const initialAccumulator: CaseAccumulator = {
    caseVerdicts: [],
    testsPassed: 0,
    maxRuntimeMs: 0,
    maxMemoryKb: 0,
    stopped: false,
  };

  const finalAccumulator = await testCases.reduce(
    async (accPromise, testCase) => runCase(await accPromise, testCase),
    Promise.resolve(initialAccumulator),
  );

  await complete({
    verdict: foldSubmissionVerdict(finalAccumulator.caseVerdicts),
    testsPassed: finalAccumulator.testsPassed,
    testsTotal: testCases.length,
    maxRuntimeMs: finalAccumulator.maxRuntimeMs,
    maxMemoryKb: finalAccumulator.maxMemoryKb,
  });
};

/**
 * Dead-letter handler: a job that exhausted every pg-boss retry (worker crash,
 * Docker daemon failure) is marked `system_error` rather than left `queued`/`running`
 * forever (contracts/sandbox-profile.md's exit-status table).
 */
export const markSubmissionAsSystemError = async (db: Kysely<Database>, payload: EvaluationJobPayload): Promise<void> => {
  const submission = await db
    .selectFrom('submissions')
    .select('user_id')
    .where('id', '=', payload.submissionId)
    .executeTakeFirst();
  if (!submission) {
    return;
  }

  await db
    .updateTable('submissions')
    .set({ status: 'complete', verdict: 'system_error', completed_at: new Date() })
    .where('id', '=', payload.submissionId)
    .execute();

  await writeAuditEvent(db, {
    eventType: 'submission.completed',
    userId: submission.user_id,
    data: { verdict: 'system_error' },
  });
};
