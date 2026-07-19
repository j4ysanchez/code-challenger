import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { createLogger } from '../../platform/logger.js';
import { createDb, type Database } from '../../platform/db.js';
import type { Clock } from '../../platform/clock.js';
import { firstCookie, requireEnv } from '../../platform/test-env.js';
import { registerAuthRoutes } from '../auth/auth.js';
import { registerSubmissionDetailRoute } from './detail.js';
import type { Kysely } from 'kysely';

const databaseUrl = requireEnv('DATABASE_URL_API');
const migratorDb = createDb(requireEnv('DATABASE_URL_MIGRATOR'));

const testConfig = {
  databaseUrl,
  sessionCookieSecret: 'a'.repeat(32),
  port: 3000,
  appOrigin: 'http://localhost:5173',
  nodeEnv: 'test' as const,
};

class FakeClock implements Clock {
  now(): Date {
    return new Date();
  }
}

const withOrigin = (headers: Record<string, string> = {}): Record<string, string> => ({
  origin: testConfig.appOrigin,
  ...headers,
});

const uniqueEmail = (): string => `submissions-detail-test-${randomUUID()}@example.com`;

const buildTestApp = async (): Promise<{ app: App; db: Kysely<Database> }> => {
  const db = createDb(databaseUrl);
  const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
  const clock = new FakeClock();
  registerAuthRoutes(app, { db, clock, config: testConfig });
  registerSubmissionDetailRoute(app, { db, clock });
  return { app, db };
};

const registerAndLogin = async (app: App): Promise<{ cookie: { name: string; value: string }; userId: string }> => {
  const email = uniqueEmail();
  await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: withOrigin(),
    payload: { email, password: 'a-fine-password' },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: withOrigin(),
    payload: { email, password: 'a-fine-password' },
  });
  return { cookie: firstCookie(login), userId: login.json().user.id };
};

const seedProblem = async (db: Kysely<Database>, slug: string): Promise<string> => {
  const row = await db
    .insertInto('problems')
    .values({ slug, title: 'Detail Test', statement_md: '# s', difficulty: 'easy', status: 'published' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
};

interface SeedSubmissionOptions {
  readonly userId: string;
  readonly problemId: string;
  readonly status?: 'queued' | 'running' | 'complete';
  readonly verdict?: 'accepted' | 'wrong_answer' | 'runtime_error' | 'compile_error' | null;
  readonly testsPassed?: number | null;
  readonly testsTotal?: number | null;
}

const seedSubmission = async (db: Kysely<Database>, options: SeedSubmissionOptions): Promise<string> => {
  const row = await db
    .insertInto('submissions')
    .values({
      user_id: options.userId,
      problem_id: options.problemId,
      language: 'python',
      source_code: 'print(1)',
      status: options.status ?? 'complete',
      verdict: options.verdict ?? 'accepted',
      tests_passed: options.testsPassed ?? 1,
      tests_total: options.testsTotal ?? 1,
      completed_at: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
};

afterAll(async () => {
  await migratorDb.deleteFrom('submission_test_results').execute();
  await migratorDb.deleteFrom('submissions').where('user_id', 'in', (eb) =>
    eb.selectFrom('users').select('id').where('email', 'like', 'submissions-detail-test-%'),
  ).execute();
  await migratorDb.deleteFrom('audit_events').where('event_type', 'like', 'auth.%').execute();
  await migratorDb.deleteFrom('sessions').execute();
  await migratorDb.deleteFrom('problems').where('slug', 'like', 'submissions-detail-test-%').execute();
  await migratorDb.deleteFrom('users').where('email', 'like', 'submissions-detail-test-%').execute();
  await migratorDb.destroy();
});

describe('GET /api/submissions/:id', () => {
  it('requires a session', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: `/api/submissions/${randomUUID()}` });
    expect(response.statusCode).toBe(401);
  });

  it('returns the full detail shape for the owner', async () => {
    const { app, db } = await buildTestApp();
    const { cookie, userId } = await registerAndLogin(app);
    const slug = `submissions-detail-test-${randomUUID()}`;
    const problemId = await seedProblem(db, slug);
    const submissionId = await seedSubmission(db, { userId, problemId });

    const response = await app.inject({
      method: 'GET',
      url: `/api/submissions/${submissionId}`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(response.statusCode).toBe(200);
    const { submission } = response.json();
    expect(submission).toMatchObject({
      id: submissionId,
      problemSlug: slug,
      language: 'python',
      status: 'complete',
      verdict: 'accepted',
      testsPassed: 1,
      testsTotal: 1,
      sourceCode: 'print(1)',
    });
    expect(submission.firstFailure).toBeUndefined();
  });

  it('returns 404 for a non-owner (indistinguishable from missing)', async () => {
    const { app, db } = await buildTestApp();
    const owner = await registerAndLogin(app);
    const otherUser = await registerAndLogin(app);
    const slug = `submissions-detail-test-${randomUUID()}`;
    const problemId = await seedProblem(db, slug);
    const submissionId = await seedSubmission(db, { userId: owner.userId, problemId });

    const asOther = await app.inject({
      method: 'GET',
      url: `/api/submissions/${submissionId}`,
      cookies: { [otherUser.cookie.name]: otherUser.cookie.value },
    });
    const missing = await app.inject({
      method: 'GET',
      url: `/api/submissions/${randomUUID()}`,
      cookies: { [otherUser.cookie.name]: otherUser.cookie.value },
    });
    expect(asOther.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(asOther.json()).toEqual(missing.json());
  });

  it('reveals full input/expected/actual for a visible failing case', async () => {
    const { app, db } = await buildTestApp();
    const { cookie, userId } = await registerAndLogin(app);
    const slug = `submissions-detail-test-${randomUUID()}`;
    const problemId = await seedProblem(db, slug);
    const submissionId = await seedSubmission(db, {
      userId,
      problemId,
      verdict: 'wrong_answer',
      testsPassed: 0,
      testsTotal: 1,
    });
    const testCase = await db
      .insertInto('test_cases')
      .values({ problem_id: problemId, position: 0, input: 'in', expected_output: 'expected', visible: true })
      .returning('id')
      .executeTakeFirstOrThrow();
    await migratorDb
      .insertInto('submission_test_results')
      .values({
        submission_id: submissionId,
        test_case_id: testCase.id,
        position: 0,
        passed: false,
        runtime_ms: 10,
        memory_kb: 100,
        actual_output: 'actual',
      })
      .execute();

    const response = await app.inject({
      method: 'GET',
      url: `/api/submissions/${submissionId}`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(response.json().submission.firstFailure).toEqual({
      caseIndex: 0,
      visible: true,
      input: 'in',
      expectedOutput: 'expected',
      actualOutput: 'actual',
    });
  });

  it('redacts input/expected/actual for a hidden failing case, exposing only the index', async () => {
    const { app, db } = await buildTestApp();
    const { cookie, userId } = await registerAndLogin(app);
    const slug = `submissions-detail-test-${randomUUID()}`;
    const problemId = await seedProblem(db, slug);
    const submissionId = await seedSubmission(db, {
      userId,
      problemId,
      verdict: 'wrong_answer',
      testsPassed: 0,
      testsTotal: 1,
    });
    const testCase = await db
      .insertInto('test_cases')
      .values({ problem_id: problemId, position: 3, input: 'secret-in', expected_output: 'secret-out', visible: false })
      .returning('id')
      .executeTakeFirstOrThrow();
    await migratorDb
      .insertInto('submission_test_results')
      .values({
        submission_id: submissionId,
        test_case_id: testCase.id,
        position: 3,
        passed: false,
        runtime_ms: 10,
        memory_kb: 100,
        actual_output: null,
      })
      .execute();

    const response = await app.inject({
      method: 'GET',
      url: `/api/submissions/${submissionId}`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(response.json().submission.firstFailure).toEqual({ caseIndex: 3, visible: false });
  });

  it('omits firstFailure for a compile_error verdict', async () => {
    const { app, db } = await buildTestApp();
    const { cookie, userId } = await registerAndLogin(app);
    const slug = `submissions-detail-test-${randomUUID()}`;
    const problemId = await seedProblem(db, slug);
    const submissionId = await seedSubmission(db, {
      userId,
      problemId,
      verdict: 'compile_error',
      testsPassed: 0,
      testsTotal: 1,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/submissions/${submissionId}`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(response.json().submission.firstFailure).toBeUndefined();
  });
});
