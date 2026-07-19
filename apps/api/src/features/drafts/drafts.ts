import type { Kysely } from 'kysely';
import { draftQuerySchema, draftUpsertRequestSchema, type Language } from '@code-challenger/contracts';
import { getValidatedBody, getValidatedQuery, zodBodyValidator, zodQueryValidator, type App } from '../../app.js';
import type { Clock } from '../../platform/clock.js';
import type { Database } from '../../platform/db.js';
import { errorEnvelope } from '../../platform/errors.js';
import { getSessionUser, requireMember } from '../../platform/sessions.js';

export interface DraftsDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

const findProblemId = async (db: Kysely<Database>, slug: string): Promise<string | undefined> =>
  (await db.selectFrom('problems').select('id').where('slug', '=', slug).executeTakeFirst())?.id;

export const registerDraftsRoutes = (app: App, deps: DraftsDeps): void => {
  app.get(
    '/api/problems/:slug/draft',
    { preHandler: [requireMember(deps.db, deps.clock), zodQueryValidator(draftQuerySchema)] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const { language } = getValidatedQuery<{ language: Language }>(request);
      const user = getSessionUser(request);
      if (!user) {
        await reply.code(401).send(errorEnvelope('unauthorized', 'authentication required'));
        return;
      }

      const problemId = await findProblemId(deps.db, slug);
      if (!problemId) {
        await reply.code(404).send(errorEnvelope('not_found', 'problem not found'));
        return;
      }

      const draft = await deps.db
        .selectFrom('drafts')
        .select(['code', 'updated_at'])
        .where('user_id', '=', user.id)
        .where('problem_id', '=', problemId)
        .where('language', '=', language)
        .executeTakeFirst();

      await reply.send({
        draft: draft ? { code: draft.code, updatedAt: draft.updated_at.toISOString() } : null,
      });
    },
  );

  app.put(
    '/api/problems/:slug/draft',
    { preHandler: [requireMember(deps.db, deps.clock), zodBodyValidator(draftUpsertRequestSchema)] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const body = getValidatedBody<{ language: Language; code: string }>(request);
      const user = getSessionUser(request);
      if (!user) {
        await reply.code(401).send(errorEnvelope('unauthorized', 'authentication required'));
        return;
      }

      const problemId = await findProblemId(deps.db, slug);
      if (!problemId) {
        await reply.code(404).send(errorEnvelope('not_found', 'problem not found'));
        return;
      }

      const now = deps.clock.now();
      await deps.db
        .insertInto('drafts')
        .values({ user_id: user.id, problem_id: problemId, language: body.language, code: body.code, updated_at: now })
        .onConflict((oc) =>
          oc.columns(['user_id', 'problem_id', 'language']).doUpdateSet({ code: body.code, updated_at: now }),
        )
        .execute();

      await reply.code(204).send();
    },
  );
};
