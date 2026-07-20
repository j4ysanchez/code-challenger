import type { Kysely } from 'kysely';
import {
  createProblemRequestSchema,
  patchProblemRequestSchema,
  replaceTestCasesRequestSchema,
  LANGUAGES,
  type Language,
} from '@code-challenger/contracts';
import { getValidatedBody, zodBodyValidator, type App } from '../../app.js';
import type { Clock } from '../../platform/clock.js';
import type { Database } from '../../platform/db.js';
import { errorEnvelope } from '../../platform/errors.js';
import { requireAdmin } from '../../platform/sessions.js';

export interface AdminProblemsDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

interface CreateProblemRequest {
  readonly slug: string;
  readonly title: string;
  readonly statementMd: string;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly tags: readonly string[];
  readonly limits: { readonly cpuTimeLimitMs: number; readonly wallTimeLimitMs: number; readonly memoryLimitMb: number };
  readonly starterCode: Partial<Record<Language, string>>;
}

type PatchProblemRequest = Partial<CreateProblemRequest>;

interface ReplaceTestCasesRequest {
  readonly testCases: readonly { readonly input: string; readonly expectedOutput: string; readonly visible: boolean }[];
}

const starterCodeForProblem = async (
  db: Kysely<Database>,
  problemId: string,
): Promise<Partial<Record<Language, string>>> => {
  const rows = await db.selectFrom('starter_code').select(['language', 'code']).where('problem_id', '=', problemId).execute();
  return Object.fromEntries(rows.map((row) => [row.language, row.code]));
};

const toAdminProblem = (
  row: {
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    readonly statement_md: string;
    readonly difficulty: 'easy' | 'medium' | 'hard';
    readonly tags: readonly string[];
    readonly status: 'draft' | 'published';
    readonly cpu_time_limit_ms: number;
    readonly wall_time_limit_ms: number;
    readonly memory_limit_mb: number;
  },
  starterCode: Partial<Record<Language, string>>,
) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  statementMd: row.statement_md,
  difficulty: row.difficulty,
  tags: row.tags,
  status: row.status,
  limits: {
    cpuTimeLimitMs: row.cpu_time_limit_ms,
    wallTimeLimitMs: row.wall_time_limit_ms,
    memoryLimitMb: row.memory_limit_mb,
  },
  starterCode,
});

export const registerAdminProblemsRoutes = (app: App, deps: AdminProblemsDeps): void => {
  app.get('/api/admin/problems', { preHandler: requireAdmin(deps.db, deps.clock) }, async (_request, reply) => {
    const rows = await deps.db.selectFrom('problems').selectAll().orderBy('created_at', 'desc').execute();
    const problems = await Promise.all(
      rows.map(async (row) => toAdminProblem(row, await starterCodeForProblem(deps.db, row.id))),
    );
    await reply.send({ problems });
  });

  app.post(
    '/api/admin/problems',
    { preHandler: [requireAdmin(deps.db, deps.clock), zodBodyValidator(createProblemRequestSchema)] },
    async (request, reply) => {
      const body = getValidatedBody<CreateProblemRequest>(request);

      const existing = await deps.db.selectFrom('problems').select('id').where('slug', '=', body.slug).executeTakeFirst();
      if (existing) {
        await reply.code(409).send(errorEnvelope('conflict', 'slug already in use'));
        return;
      }

      const row = await deps.db
        .insertInto('problems')
        .values({
          slug: body.slug,
          title: body.title,
          statement_md: body.statementMd,
          difficulty: body.difficulty,
          tags: [...body.tags],
          status: 'draft',
          cpu_time_limit_ms: body.limits.cpuTimeLimitMs,
          wall_time_limit_ms: body.limits.wallTimeLimitMs,
          memory_limit_mb: body.limits.memoryLimitMb,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await deps.db
        .insertInto('starter_code')
        .values(
          LANGUAGES.map((language) => ({ problem_id: row.id, language, code: body.starterCode[language] ?? '' })),
        )
        .execute();

      await reply.code(201).send({ problem: toAdminProblem(row, body.starterCode) });
    },
  );

  app.patch(
    '/api/admin/problems/:id',
    { preHandler: [requireAdmin(deps.db, deps.clock), zodBodyValidator(patchProblemRequestSchema)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = getValidatedBody<PatchProblemRequest>(request);

      const existing = await deps.db.selectFrom('problems').selectAll().where('id', '=', id).executeTakeFirst();
      if (!existing) {
        await reply.code(404).send(errorEnvelope('not_found', 'problem not found'));
        return;
      }

      if (body.slug !== undefined && body.slug !== existing.slug) {
        const slugTaken = await deps.db
          .selectFrom('problems')
          .select('id')
          .where('slug', '=', body.slug)
          .where('id', '!=', id)
          .executeTakeFirst();
        if (slugTaken) {
          await reply.code(409).send(errorEnvelope('conflict', 'slug already in use'));
          return;
        }
      }

      await deps.db
        .updateTable('problems')
        .set({
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.statementMd !== undefined ? { statement_md: body.statementMd } : {}),
          ...(body.difficulty !== undefined ? { difficulty: body.difficulty } : {}),
          ...(body.tags !== undefined ? { tags: [...body.tags] } : {}),
          ...(body.limits !== undefined
            ? {
                cpu_time_limit_ms: body.limits.cpuTimeLimitMs,
                wall_time_limit_ms: body.limits.wallTimeLimitMs,
                memory_limit_mb: body.limits.memoryLimitMb,
              }
            : {}),
          updated_at: deps.clock.now(),
        })
        .where('id', '=', id)
        .execute();

      if (body.starterCode !== undefined) {
        for (const language of LANGUAGES) {
          const code = body.starterCode[language];
          if (code === undefined) {
            continue;
          }
          await deps.db
            .insertInto('starter_code')
            .values({ problem_id: id, language, code })
            .onConflict((oc) => oc.columns(['problem_id', 'language']).doUpdateSet({ code }))
            .execute();
        }
      }

      const updated = await deps.db.selectFrom('problems').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      await reply.send({ problem: toAdminProblem(updated, await starterCodeForProblem(deps.db, id)) });
    },
  );

  app.put(
    '/api/admin/problems/:id/test-cases',
    { preHandler: [requireAdmin(deps.db, deps.clock), zodBodyValidator(replaceTestCasesRequestSchema)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = getValidatedBody<ReplaceTestCasesRequest>(request);

      const existing = await deps.db.selectFrom('problems').select('id').where('id', '=', id).executeTakeFirst();
      if (!existing) {
        await reply.code(404).send(errorEnvelope('not_found', 'problem not found'));
        return;
      }

      await deps.db.transaction().execute(async (trx) => {
        await trx.deleteFrom('test_cases').where('problem_id', '=', id).execute();
        await trx
          .insertInto('test_cases')
          .values(
            body.testCases.map((testCase, position) => ({
              problem_id: id,
              position,
              input: testCase.input,
              expected_output: testCase.expectedOutput,
              visible: testCase.visible,
            })),
          )
          .execute();
      });

      await reply.code(204).send();
    },
  );
};
