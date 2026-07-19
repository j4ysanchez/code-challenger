import { sql, type Kysely } from 'kysely';
import { problemsListQuerySchema, type Difficulty } from '@code-challenger/contracts';
import { getValidatedQuery, zodQueryValidator, type App } from '../../app.js';
import type { Clock } from '../../platform/clock.js';
import type { Database } from '../../platform/db.js';
import { errorEnvelope } from '../../platform/errors.js';
import { getSessionUser, optionalSession } from '../../platform/sessions.js';

export interface ProblemsDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

/** Solved status: accepted-verdict partial index (data-model.md submissions indexes), scoped to the caller. */
const solvedProblemIds = async (
  db: Kysely<Database>,
  userId: string,
  problemIds: readonly string[],
): Promise<ReadonlySet<string>> => {
  if (problemIds.length === 0) {
    return new Set();
  }
  const rows = await db
    .selectFrom('submissions')
    .select('problem_id')
    .distinct()
    .where('user_id', '=', userId)
    .where('verdict', '=', 'accepted')
    .where('problem_id', 'in', problemIds)
    .execute();
  return new Set(rows.map((row) => row.problem_id));
};

interface ProblemsListQuery {
  readonly difficulty?: Difficulty;
  readonly tag?: string;
}

export const registerProblemsRoutes = (app: App, deps: ProblemsDeps): void => {
  app.get(
    '/api/problems',
    { preHandler: [optionalSession(deps.db, deps.clock), zodQueryValidator(problemsListQuerySchema)] },
    async (request, reply) => {
      const query = getValidatedQuery<ProblemsListQuery>(request);
      const user = getSessionUser(request);

      const base = deps.db
        .selectFrom('problems')
        .select(['id', 'slug', 'title', 'difficulty', 'tags'])
        .where('status', '=', 'published');
      const withDifficulty = query.difficulty ? base.where('difficulty', '=', query.difficulty) : base;
      const withTag = query.tag ? withDifficulty.where(sql<boolean>`${query.tag} = any(tags)`) : withDifficulty;

      const rows = await withTag.orderBy('created_at', 'desc').execute();
      const solved = user ? await solvedProblemIds(deps.db, user.id, rows.map((row) => row.id)) : new Set<string>();

      await reply.send({
        problems: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          title: row.title,
          difficulty: row.difficulty,
          tags: row.tags,
          ...(user ? { solved: solved.has(row.id) } : {}),
        })),
      });
    },
  );

  app.get(
    '/api/problems/:slug',
    { preHandler: optionalSession(deps.db, deps.clock) },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const user = getSessionUser(request);

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
      const solved = user ? await solvedProblemIds(deps.db, user.id, [problem.id]) : new Set<string>();

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
          ...(user ? { solved: solved.has(problem.id) } : {}),
        },
      });
    },
  );
};
