import type { Kysely } from 'kysely';
import { createSubmissionRequestSchema, type EvaluationJobPayload, type Language } from '@code-challenger/contracts';
import { getValidatedBody, zodBodyValidator, type App } from '../../app.js';
import { writeAuditEvent } from '../../platform/audit.js';
import type { Clock } from '../../platform/clock.js';
import type { Database } from '../../platform/db.js';
import { errorEnvelope } from '../../platform/errors.js';
import { getSessionUser, requireMember } from '../../platform/sessions.js';

export interface SubmissionsCreateDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  readonly enqueue: (payload: EvaluationJobPayload) => Promise<void>;
}

/** FR-009: per-user submission rate limit, backed by Postgres (research.md R7) rather than the per-IP plugin. */
const RATE_LIMIT_MAX = 6;
const RATE_LIMIT_WINDOW_SECONDS = 60;

const isRateLimited = async (db: Kysely<Database>, userId: string, clock: Clock): Promise<boolean> => {
  const windowStart = new Date(clock.now().getTime() - RATE_LIMIT_WINDOW_SECONDS * 1000);
  const row = await db
    .selectFrom('submissions')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('user_id', '=', userId)
    .where('created_at', '>=', windowStart)
    .executeTakeFirstOrThrow();
  return Number(row.count) >= RATE_LIMIT_MAX;
};

export const registerCreateSubmissionRoute = (app: App, deps: SubmissionsCreateDeps): void => {
  app.post(
    '/api/problems/:slug/submissions',
    // FR-005: validation (session via requireMember, language allowlist + 1B-100KB source via the
    // Zod schema) happens entirely before any row is written or job enqueued.
    { preHandler: [requireMember(deps.db, deps.clock), zodBodyValidator(createSubmissionRequestSchema)] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const body = getValidatedBody<{ language: Language; source: string }>(request);
      const user = getSessionUser(request);
      if (!user) {
        await reply.code(401).send(errorEnvelope('unauthorized', 'authentication required'));
        return;
      }

      const problem = await deps.db
        .selectFrom('problems')
        .select('id')
        .where('slug', '=', slug)
        .where('status', '=', 'published')
        .executeTakeFirst();
      if (!problem) {
        await reply.code(404).send(errorEnvelope('not_found', 'problem not found'));
        return;
      }

      if (await isRateLimited(deps.db, user.id, deps.clock)) {
        await reply
          .header('Retry-After', String(RATE_LIMIT_WINDOW_SECONDS))
          .code(429)
          .send(errorEnvelope('rate_limited', 'too many submissions — try again shortly'));
        return;
      }

      const row = await deps.db
        .insertInto('submissions')
        .values({ user_id: user.id, problem_id: problem.id, language: body.language, source_code: body.source })
        .returning('id')
        .executeTakeFirstOrThrow();

      await deps.enqueue({ submissionId: row.id });
      await writeAuditEvent(deps.db, {
        eventType: 'submission.created',
        userId: user.id,
        data: { problemId: problem.id, language: body.language },
      });

      await reply.code(202).send({ submission: { id: row.id, status: 'queued' } });
    },
  );
};
