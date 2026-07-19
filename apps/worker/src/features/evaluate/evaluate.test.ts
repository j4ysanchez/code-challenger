import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../platform/db.js';
import { requireEnv } from '../../../tests/test-env.js';
import { evaluateSubmission, markSubmissionAsSystemError } from './evaluate.js';

const workerDb = createDb(requireEnv('DATABASE_URL_WORKER'));
// Seeding users/problems/test_cases/submissions needs api_role's broader grants; worker_role
// can only SELECT problems/test_cases and SELECT/UPDATE submissions (least privilege).
const seedPool = new pg.Pool({ connectionString: requireEnv('DATABASE_URL_API') });
// api_role has no DELETE on submissions (INSERT/SELECT only, by design) — cleanup needs the migrator connection.
const migratorPool = new pg.Pool({ connectionString: requireEnv('DATABASE_URL_MIGRATOR') });

interface SeedTestCase {
  readonly position: number;
  readonly input: string;
  readonly expectedOutput: string;
  readonly visible: boolean;
}

const seedProblem = async (testCases: readonly SeedTestCase[]): Promise<string> => {
  const problemId = randomUUID();
  await seedPool.query(
    `insert into problems (id, slug, title, statement_md, difficulty, status, cpu_time_limit_ms, wall_time_limit_ms, memory_limit_mb)
     values ($1, $2, 'Test Problem', 'add two numbers', 'easy', 'published', 2000, 10000, 256)`,
    [problemId, `evaluate-test-${problemId}`],
  );
  for (const testCase of testCases) {
    await seedPool.query(
      `insert into test_cases (problem_id, "position", input, expected_output, visible) values ($1, $2, $3, $4, $5)`,
      [problemId, testCase.position, testCase.input, testCase.expectedOutput, testCase.visible],
    );
  }
  return problemId;
};

const seedUser = async (): Promise<string> => {
  const userId = randomUUID();
  await seedPool.query(`insert into users (id, email, password_hash) values ($1, $2, 'unused')`, [
    userId,
    `evaluate-test-${userId}@example.com`,
  ]);
  return userId;
};

const seedSubmission = async (params: {
  readonly userId: string;
  readonly problemId: string;
  readonly language: 'python' | 'javascript';
  readonly sourceCode: string;
}): Promise<string> => {
  const submissionId = randomUUID();
  await seedPool.query(
    `insert into submissions (id, user_id, problem_id, language, source_code) values ($1, $2, $3, $4, $5)`,
    [submissionId, params.userId, params.problemId, params.language, params.sourceCode],
  );
  return submissionId;
};

/** Per-test teardown — api_role has no DELETE on submissions, so cleanup needs the migrator connection. */
const cleanupSeed = async (problemId: string, userId: string): Promise<void> => {
  await migratorPool.query('delete from submissions where problem_id = $1', [problemId]);
  await migratorPool.query('delete from problems where id = $1', [problemId]);
  await migratorPool.query('delete from users where id = $1', [userId]);
};

afterAll(async () => {
  await workerDb.destroy();
  await seedPool.end();
  await migratorPool.end();
});

const ADD_TWO_NUMBERS = 'a, b = (int(x) for x in input().split())\nprint(a + b)\n';

describe('evaluateSubmission', () => {
  it('marks a fully correct submission accepted', async () => {
    const problemId = await seedProblem([
      { position: 0, input: '2 3', expectedOutput: '5', visible: true },
      { position: 1, input: '10 15', expectedOutput: '25', visible: false },
    ]);
    const userId = await seedUser();
    try {
      const submissionId = await seedSubmission({ userId, problemId, language: 'python', sourceCode: ADD_TWO_NUMBERS });

      await evaluateSubmission(workerDb, { submissionId });

      const submission = await workerDb
        .selectFrom('submissions')
        .selectAll()
        .where('id', '=', submissionId)
        .executeTakeFirstOrThrow();
      expect(submission.status).toBe('complete');
      expect(submission.verdict).toBe('accepted');
      expect(submission.tests_passed).toBe(2);
      expect(submission.tests_total).toBe(2);

      const results = await workerDb
        .selectFrom('submission_test_results')
        .selectAll()
        .where('submission_id', '=', submissionId)
        .orderBy('position', 'asc')
        .execute();
      expect(results).toHaveLength(2);
      expect(results[0]?.actual_output).toBe('5\n');
      expect(results[1]?.actual_output).toBeNull();
    } finally {
      await cleanupSeed(problemId, userId);
    }
  }, 20_000);

  it('reports wrong_answer with the visible case output stored', async () => {
    const problemId = await seedProblem([{ position: 0, input: '2 3', expectedOutput: '99', visible: true }]);
    const userId = await seedUser();
    try {
      const submissionId = await seedSubmission({ userId, problemId, language: 'python', sourceCode: ADD_TWO_NUMBERS });

      await evaluateSubmission(workerDb, { submissionId });

      const submission = await workerDb
        .selectFrom('submissions')
        .selectAll()
        .where('id', '=', submissionId)
        .executeTakeFirstOrThrow();
      expect(submission.verdict).toBe('wrong_answer');
      expect(submission.tests_passed).toBe(0);

      const [result] = await workerDb
        .selectFrom('submission_test_results')
        .selectAll()
        .where('submission_id', '=', submissionId)
        .execute();
      expect(result?.actual_output).toBe('5\n');
    } finally {
      await cleanupSeed(problemId, userId);
    }
  }, 20_000);

  it('short-circuits on a compile error with no test cases run', async () => {
    const problemId = await seedProblem([{ position: 0, input: '2 3', expectedOutput: '5', visible: true }]);
    const userId = await seedUser();
    try {
      const submissionId = await seedSubmission({
        userId,
        problemId,
        language: 'python',
        sourceCode: 'def broken(:\n    pass\n',
      });

      await evaluateSubmission(workerDb, { submissionId });

      const submission = await workerDb
        .selectFrom('submissions')
        .selectAll()
        .where('id', '=', submissionId)
        .executeTakeFirstOrThrow();
      expect(submission.verdict).toBe('compile_error');
      expect(submission.tests_passed).toBe(0);
      expect(submission.tests_total).toBe(1);

      const results = await workerDb
        .selectFrom('submission_test_results')
        .selectAll()
        .where('submission_id', '=', submissionId)
        .execute();
      expect(results).toHaveLength(0);
    } finally {
      await cleanupSeed(problemId, userId);
    }
  }, 20_000);

  it('stops early after a hidden-case failure but keeps going past a visible one', async () => {
    // case 0 (visible) fails, case 1 (hidden) still runs (visible failures don't stop
    // evaluation); case 1 fails too, and since it's hidden, case 2 never runs.
    const problemId = await seedProblem([
      { position: 0, input: '2 3', expectedOutput: 'wrong', visible: true },
      { position: 1, input: '10 15', expectedOutput: 'also-wrong', visible: false },
      { position: 2, input: '1 1', expectedOutput: '2', visible: false },
    ]);
    const userId = await seedUser();
    try {
      const submissionId = await seedSubmission({ userId, problemId, language: 'python', sourceCode: ADD_TWO_NUMBERS });

      await evaluateSubmission(workerDb, { submissionId });

      const results = await workerDb
        .selectFrom('submission_test_results')
        .selectAll()
        .where('submission_id', '=', submissionId)
        .orderBy('position', 'asc')
        .execute();
      expect(results.map((r) => r.position)).toEqual([0, 1]);

      const submission = await workerDb
        .selectFrom('submissions')
        .selectAll()
        .where('id', '=', submissionId)
        .executeTakeFirstOrThrow();
      expect(submission.verdict).toBe('wrong_answer');
      expect(submission.tests_total).toBe(3);
    } finally {
      await cleanupSeed(problemId, userId);
    }
  }, 20_000);
});

describe('markSubmissionAsSystemError', () => {
  it('marks a dead-lettered submission complete with a system_error verdict', async () => {
    const problemId = await seedProblem([{ position: 0, input: '2 3', expectedOutput: '5', visible: true }]);
    const userId = await seedUser();
    try {
      const submissionId = await seedSubmission({ userId, problemId, language: 'python', sourceCode: ADD_TWO_NUMBERS });

      await markSubmissionAsSystemError(workerDb, { submissionId });

      const submission = await workerDb
        .selectFrom('submissions')
        .selectAll()
        .where('id', '=', submissionId)
        .executeTakeFirstOrThrow();
      expect(submission.status).toBe('complete');
      expect(submission.verdict).toBe('system_error');
      expect(submission.completed_at).not.toBeNull();
    } finally {
      await cleanupSeed(problemId, userId);
    }
  });
});
