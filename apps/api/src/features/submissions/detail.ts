import type { Kysely } from 'kysely';
import type { Clock } from '../../platform/clock.js';
import type { Database } from '../../platform/db.js';
import { errorEnvelope } from '../../platform/errors.js';
import { getSessionUser, requireMember } from '../../platform/sessions.js';
import type { App } from '../../app.js';

export interface SubmissionsDetailDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

/** Verdicts for which a failing case's detail is surfaced (contracts/api.md). */
const VERDICTS_WITH_FIRST_FAILURE = new Set(['wrong_answer', 'runtime_error']);

export const registerSubmissionDetailRoute = (app: App, deps: SubmissionsDetailDeps): void => {
  app.get('/api/submissions/:id', { preHandler: requireMember(deps.db, deps.clock) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = getSessionUser(request);
    if (!user) {
      await reply.code(401).send(errorEnvelope('unauthorized', 'authentication required'));
      return;
    }

    // Ownership scoping (FR-012): a non-owner's request is indistinguishable from a missing id.
    const submission = await deps.db
      .selectFrom('submissions')
      .innerJoin('problems', 'problems.id', 'submissions.problem_id')
      .select([
        'submissions.id as id',
        'problems.slug as problem_slug',
        'submissions.language as language',
        'submissions.status as status',
        'submissions.verdict as verdict',
        'submissions.tests_passed as tests_passed',
        'submissions.tests_total as tests_total',
        'submissions.max_runtime_ms as max_runtime_ms',
        'submissions.max_memory_kb as max_memory_kb',
        'submissions.created_at as created_at',
        'submissions.completed_at as completed_at',
        'submissions.source_code as source_code',
      ])
      .where('submissions.id', '=', id)
      .where('submissions.user_id', '=', user.id)
      .executeTakeFirst();
    if (!submission) {
      await reply.code(404).send(errorEnvelope('not_found', 'submission not found'));
      return;
    }

    const firstFailingCase = submission.verdict && VERDICTS_WITH_FIRST_FAILURE.has(submission.verdict)
      ? await deps.db
          .selectFrom('submission_test_results')
          .innerJoin('test_cases', 'test_cases.id', 'submission_test_results.test_case_id')
          .select([
            'submission_test_results.position as position',
            'submission_test_results.actual_output as actual_output',
            'test_cases.input as input',
            'test_cases.expected_output as expected_output',
            'test_cases.visible as visible',
          ])
          .where('submission_test_results.submission_id', '=', id)
          .where('submission_test_results.passed', '=', false)
          .orderBy('submission_test_results.position', 'asc')
          .executeTakeFirst()
      : undefined;

    // Hidden-case redaction (FR-008): only caseIndex + visible:false ever leave the trust boundary.
    const firstFailure = firstFailingCase
      ? firstFailingCase.visible
        ? {
            caseIndex: firstFailingCase.position,
            visible: true as const,
            input: firstFailingCase.input,
            expectedOutput: firstFailingCase.expected_output,
            actualOutput: firstFailingCase.actual_output ?? '',
          }
        : { caseIndex: firstFailingCase.position, visible: false as const }
      : undefined;

    await reply.send({
      submission: {
        id: submission.id,
        problemSlug: submission.problem_slug,
        language: submission.language,
        status: submission.status,
        verdict: submission.verdict,
        testsPassed: submission.tests_passed,
        testsTotal: submission.tests_total,
        maxRuntimeMs: submission.max_runtime_ms,
        maxMemoryKb: submission.max_memory_kb,
        createdAt: submission.created_at.toISOString(),
        completedAt: submission.completed_at ? submission.completed_at.toISOString() : null,
        sourceCode: submission.source_code,
        ...(firstFailure ? { firstFailure } : {}),
      },
    });
  });
};
