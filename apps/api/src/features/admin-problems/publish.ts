import type { Kysely } from 'kysely';
import { getSessionUser, requireAdmin } from '../../platform/sessions.js';
import { writeAuditEvent } from '../../platform/audit.js';
import type { Clock } from '../../platform/clock.js';
import type { Database } from '../../platform/db.js';
import { errorEnvelope } from '../../platform/errors.js';
import type { App } from '../../app.js';

export interface PublishDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

/** Publish requires >=1 visible and >=1 hidden test case (contracts/api.md, data-model.md). */
const hasPublishableTestCases = async (db: Kysely<Database>, problemId: string): Promise<boolean> => {
  const rows = await db
    .selectFrom('test_cases')
    .select(['visible', (eb) => eb.fn.countAll<string>().as('count')])
    .where('problem_id', '=', problemId)
    .groupBy('visible')
    .execute();
  const visibleCount = Number(rows.find((row) => row.visible)?.count ?? 0);
  const hiddenCount = Number(rows.find((row) => !row.visible)?.count ?? 0);
  return visibleCount >= 1 && hiddenCount >= 1;
};

export const registerPublishRoutes = (app: App, deps: PublishDeps): void => {
  app.post(
    '/api/admin/problems/:id/publish',
    { preHandler: requireAdmin(deps.db, deps.clock) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = getSessionUser(request);

      const problem = await deps.db.selectFrom('problems').select('id').where('id', '=', id).executeTakeFirst();
      if (!problem) {
        await reply.code(404).send(errorEnvelope('not_found', 'problem not found'));
        return;
      }

      if (!(await hasPublishableTestCases(deps.db, id))) {
        await reply
          .code(422)
          .send(errorEnvelope('validation_failed', 'publishing requires at least one visible and one hidden test case'));
        return;
      }

      await deps.db
        .updateTable('problems')
        .set({ status: 'published', updated_at: deps.clock.now() })
        .where('id', '=', id)
        .execute();
      await writeAuditEvent(deps.db, { eventType: 'problem.published', userId: user?.id ?? null, data: { problemId: id } });

      await reply.code(204).send();
    },
  );

  app.post(
    '/api/admin/problems/:id/unpublish',
    { preHandler: requireAdmin(deps.db, deps.clock) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = getSessionUser(request);

      const problem = await deps.db.selectFrom('problems').select('id').where('id', '=', id).executeTakeFirst();
      if (!problem) {
        await reply.code(404).send(errorEnvelope('not_found', 'problem not found'));
        return;
      }

      await deps.db
        .updateTable('problems')
        .set({ status: 'draft', updated_at: deps.clock.now() })
        .where('id', '=', id)
        .execute();
      await writeAuditEvent(deps.db, { eventType: 'problem.unpublished', userId: user?.id ?? null, data: { problemId: id } });

      await reply.code(204).send();
    },
  );
};
