import type { Kysely } from 'kysely';
import { errorEnvelope } from '../../platform/errors.js';
import { getSessionUser, requireMember } from '../../platform/sessions.js';
import type { Clock } from '../../platform/clock.js';
import type { Database } from '../../platform/db.js';
import type { App } from '../../app.js';

export interface HistoryDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

export const registerHistoryRoute = (app: App, deps: HistoryDeps): void => {
  app.get(
    '/api/problems/:slug/submissions',
    { preHandler: requireMember(deps.db, deps.clock) },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const user = getSessionUser(request);
      if (!user) {
        await reply.code(401).send(errorEnvelope('unauthorized', 'authentication required'));
        return;
      }

      const problem = await deps.db.selectFrom('problems').select('id').where('slug', '=', slug).executeTakeFirst();
      if (!problem) {
        await reply.code(404).send(errorEnvelope('not_found', 'problem not found'));
        return;
      }

      // Own submissions only (FR-012), newest first (contracts/api.md).
      const rows = await deps.db
        .selectFrom('submissions')
        .select(['id', 'language', 'status', 'verdict', 'tests_passed', 'tests_total', 'created_at'])
        .where('problem_id', '=', problem.id)
        .where('user_id', '=', user.id)
        .orderBy('created_at', 'desc')
        .execute();

      await reply.send({
        submissions: rows.map((row) => ({
          id: row.id,
          language: row.language,
          status: row.status,
          verdict: row.verdict,
          testsPassed: row.tests_passed,
          testsTotal: row.tests_total,
          createdAt: row.created_at.toISOString(),
        })),
      });
    },
  );
};
