import { sql, type Kysely } from 'kysely';
import { problemsListQuerySchema, type Difficulty } from '@code-challenger/contracts';
import { getValidatedQuery, zodQueryValidator, type App } from '../../app.js';
import type { Database } from '../../platform/db.js';
import { errorEnvelope } from '../../platform/errors.js';

export interface ProblemsDeps {
  readonly db: Kysely<Database>;
}

interface ProblemsListQuery {
  readonly difficulty?: Difficulty;
  readonly tag?: string;
}

export const registerProblemsRoutes = (app: App, deps: ProblemsDeps): void => {
  app.get(
    '/api/problems',
    { preHandler: zodQueryValidator(problemsListQuerySchema) },
    async (request, reply) => {
      const query = getValidatedQuery<ProblemsListQuery>(request);

      const base = deps.db
        .selectFrom('problems')
        .select(['id', 'slug', 'title', 'difficulty', 'tags'])
        .where('status', '=', 'published');
      const withDifficulty = query.difficulty ? base.where('difficulty', '=', query.difficulty) : base;
      const withTag = query.tag ? withDifficulty.where(sql<boolean>`${query.tag} = any(tags)`) : withDifficulty;

      const rows = await withTag.orderBy('created_at', 'desc').execute();
      await reply.send({
        problems: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          title: row.title,
          difficulty: row.difficulty,
          tags: row.tags,
        })),
      });
    },
  );

  app.get('/api/problems/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const problem = await deps.db
      .selectFrom('problems')
      .selectAll()
      .where('slug', '=', slug)
      .where('status', '=', 'published')
      .executeTakeFirst();
    if (!problem) {
      await reply.code(404).send(errorEnvelope('not_found', 'problem not found'));
      return;
    }

    const starterRows = await deps.db
      .selectFrom('starter_code')
      .select(['language', 'code'])
      .where('problem_id', '=', problem.id)
      .execute();
    const visibleCases = await deps.db
      .selectFrom('test_cases')
      .select(['input', 'expected_output'])
      .where('problem_id', '=', problem.id)
      .where('visible', '=', true)
      .orderBy('position', 'asc')
      .execute();

    await reply.send({
      problem: {
        id: problem.id,
        slug: problem.slug,
        title: problem.title,
        statementMd: problem.statement_md,
        difficulty: problem.difficulty,
        tags: problem.tags,
        limits: {
          cpuTimeLimitMs: problem.cpu_time_limit_ms,
          wallTimeLimitMs: problem.wall_time_limit_ms,
          memoryLimitMb: problem.memory_limit_mb,
        },
        starterCode: Object.fromEntries(starterRows.map((row) => [row.language, row.code])),
        visibleTestCases: visibleCases.map((testCase) => ({
          input: testCase.input,
          expectedOutput: testCase.expected_output,
        })),
      },
    });
  });
};
