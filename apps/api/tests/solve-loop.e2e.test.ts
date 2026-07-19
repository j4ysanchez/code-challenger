import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { afterAll, describe, expect, it } from 'vitest';
import type { EvaluationJobPayload } from '@code-challenger/contracts';
import { buildApp } from '../src/app.js';
import { createLogger } from '../src/platform/logger.js';
import { createDb as createApiDb, type Database as ApiDatabase } from '../src/platform/db.js';
import { systemClock } from '../src/platform/clock.js';
import { requireEnv } from '../src/platform/test-env.js';
import { registerAuthRoutes } from '../src/features/auth/auth.js';
import { registerCreateSubmissionRoute } from '../src/features/submissions/create.js';
import { registerSubmissionDetailRoute } from '../src/features/submissions/detail.js';
// Cross-app import: this is the one place the API's own tests drive the real worker end-to-end
// (real pg-boss queue, real evaluateSubmission, real hardened sandbox containers) to prove the
// full solve loop — production code never reaches across the api/worker trust boundary like this.
import { createDb as createWorkerDb } from '../../worker/src/platform/db.js';
import { evaluateSubmission } from '../../worker/src/features/evaluate/evaluate.js';
import type { Kysely } from 'kysely';

const apiDatabaseUrl = requireEnv('DATABASE_URL_API');
const workerDatabaseUrl = requireEnv('DATABASE_URL_WORKER');
const migratorDb = createApiDb(requireEnv('DATABASE_URL_MIGRATOR'));

const testConfig = {
  databaseUrl: apiDatabaseUrl,
  sessionCookieSecret: 'a'.repeat(32),
  port: 3000,
  appOrigin: 'http://localhost:5173',
  nodeEnv: 'test' as const,
};

const withOrigin = (headers: Record<string, string> = {}): Record<string, string> => ({
  origin: testConfig.appOrigin,
  ...headers,
});

// A dedicated, uniquely-named queue keeps this test's jobs isolated from the shared
// `evaluate-submission` queue that other test files (worker platform tests) also touch.
const testQueueName = `test-e2e-evaluate-${randomUUID()}`;
const boss = new PgBoss({ connectionString: workerDatabaseUrl, schema: 'pgboss', createSchema: false });
await boss.start();
await boss.createQueue(testQueueName);

const workerDb = createWorkerDb(workerDatabaseUrl);
await boss.work<EvaluationJobPayload>(testQueueName, { localConcurrency: 2 }, async (jobs) => {
  for (const job of jobs) {
    await evaluateSubmission(workerDb, job.data);
  }
});

const apiDb = createApiDb(apiDatabaseUrl);
const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
registerAuthRoutes(app, { db: apiDb, clock: systemClock, config: testConfig });
registerCreateSubmissionRoute(app, {
  db: apiDb,
  clock: systemClock,
  enqueue: async (payload) => {
    await boss.send(testQueueName, payload);
  },
});
registerSubmissionDetailRoute(app, { db: apiDb, clock: systemClock });

const SLUG = `solve-loop-e2e-${randomUUID()}`;

const seedProblem = async (db: Kysely<ApiDatabase>): Promise<void> => {
  const row = await db
    .insertInto('problems')
    .values({
      slug: SLUG,
      title: 'Sum Two Numbers (E2E)',
      statement_md: '# Sum two numbers',
      difficulty: 'easy',
      status: 'published',
      cpu_time_limit_ms: 2000,
      wall_time_limit_ms: 3000,
      memory_limit_mb: 256,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  await db
    .insertInto('test_cases')
    .values({ problem_id: row.id, position: 0, input: '2 3', expected_output: '5', visible: true })
    .execute();
};

const registerAndLogin = async (): Promise<{ name: string; value: string }> => {
  const email = `solve-loop-e2e-${randomUUID()}@example.com`;
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
  const [cookie] = login.cookies;
  if (!cookie) {
    throw new Error('expected login to set a session cookie');
  }
  return cookie;
};

const submit = async (cookie: { name: string; value: string }, source: string): Promise<string> => {
  const response = await app.inject({
    method: 'POST',
    url: `/api/problems/${SLUG}/submissions`,
    headers: withOrigin(),
    cookies: { [cookie.name]: cookie.value },
    payload: { language: 'python', source },
  });
  expect(response.statusCode).toBe(202);
  return response.json().submission.id;
};

const fetchSubmission = async (
  cookie: { name: string; value: string },
  submissionId: string,
): Promise<{ status: string; verdict: string | null; [key: string]: unknown }> => {
  const response = await app.inject({
    method: 'GET',
    url: `/api/submissions/${submissionId}`,
    cookies: { [cookie.name]: cookie.value },
  });
  return response.json().submission;
};

const waitForCompletion = async (
  cookie: { name: string; value: string },
  submissionId: string,
): Promise<{ status: string; verdict: string | null; [key: string]: unknown }> => {
  await expect.poll(async () => (await fetchSubmission(cookie, submissionId)).status, { timeout: 25_000, interval: 300 }).toBe('complete');
  return fetchSubmission(cookie, submissionId);
};

afterAll(async () => {
  await boss.stop({ graceful: false });
  await migratorDb.deleteFrom('submission_test_results').where('submission_id', 'in', (eb) =>
    eb.selectFrom('submissions').select('id').where('problem_id', 'in', (ebi) =>
      ebi.selectFrom('problems').select('id').where('slug', '=', SLUG),
    ),
  ).execute();
  await migratorDb.deleteFrom('submissions').where('problem_id', 'in', (eb) =>
    eb.selectFrom('problems').select('id').where('slug', '=', SLUG),
  ).execute();
  await migratorDb.deleteFrom('problems').where('slug', '=', SLUG).execute();
  await migratorDb.deleteFrom('audit_events').where('event_type', 'like', 'auth.%').execute();
  await migratorDb.deleteFrom('audit_events').where('event_type', '=', 'submission.created').execute();
  await migratorDb.deleteFrom('audit_events').where('event_type', '=', 'submission.completed').execute();
  await migratorDb.deleteFrom('sessions').execute();
  await migratorDb.deleteFrom('users').where('email', 'like', 'solve-loop-e2e-%').execute();
  await migratorDb.destroy();
  await apiDb.destroy();
  await workerDb.destroy();
});

describe('solve loop (User Story 1 end-to-end, real worker + sandboxes)', () => {
  it('accepts a correct solution', async () => {
    await seedProblem(apiDb);
    const cookie = await registerAndLogin();

    const submissionId = await submit(cookie, 'a, b = (int(x) for x in input().split())\nprint(a + b)\n');
    const detail = await waitForCompletion(cookie, submissionId);

    expect(detail.status).toBe('complete');
    expect(detail.verdict).toBe('accepted');
  }, 30_000);

  it('reports wrong_answer with the first failing visible case', async () => {
    const cookie = await registerAndLogin();

    const submissionId = await submit(cookie, 'a, b = (int(x) for x in input().split())\nprint(a + b + 1)\n');
    const detail = await waitForCompletion(cookie, submissionId);

    expect(detail.verdict).toBe('wrong_answer');
    expect(detail.firstFailure).toMatchObject({ caseIndex: 0, visible: true, input: '2 3', expectedOutput: '5' });
  }, 30_000);

  it('reports time_limit_exceeded for an infinite loop, still within the worker overhead bound', async () => {
    const cookie = await registerAndLogin();

    const submissionId = await submit(cookie, 'while True:\n    pass\n');
    const detail = await waitForCompletion(cookie, submissionId);

    expect(detail.verdict).toBe('time_limit_exceeded');
  }, 30_000);
});
