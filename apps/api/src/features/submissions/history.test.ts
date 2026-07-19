import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { createLogger } from '../../platform/logger.js';
import { createDb, type Database } from '../../platform/db.js';
import type { Clock } from '../../platform/clock.js';
import { firstCookie, requireEnv } from '../../platform/test-env.js';
import { registerAuthRoutes } from '../auth/auth.js';
import { registerHistoryRoute } from './history.js';
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
  private current: Date;
  constructor(start: Date) {
    this.current = start;
  }
  now(): Date {
    return this.current;
  }
}

const uniqueEmail = (): string => `history-test-${Math.random().toString(36).slice(2)}@example.com`;

const buildTestApp = async (): Promise<{ app: App; db: Kysely<Database> }> => {
  const db = createDb(databaseUrl);
  const clock = new FakeClock(new Date());
  const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
  registerAuthRoutes(app, { db, clock, config: testConfig });
  registerHistoryRoute(app, { db, clock });
  return { app, db };
};

const withOrigin = (headers: Record<string, string> = {}): Record<string, string> => ({
  origin: testConfig.appOrigin,
  ...headers,
});

const registerAndLogin = async (app: App, email: string, password: string): Promise<{ name: string; value: string }> => {
  await app.inject({ method: 'POST', url: '/api/auth/register', headers: withOrigin(), payload: { email, password } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: withOrigin(), payload: { email, password } });
  return firstCookie(login);
};

const seedProblem = async (db: Kysely<Database>, slug: string): Promise<string> => {
  const row = await db
    .insertInto('problems')
    .values({
      slug,
      title: 'History Test Problem',
      statement_md: '# statement',
      difficulty: 'easy',
      tags: [],
      status: 'published',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
};

const insertSubmission = async (
  db: Kysely<Database>,
  userId: string,
  problemId: string,
  overrides: Partial<{ status: 'queued' | 'running' | 'complete'; verdict: string | null; testsPassed: number | null; testsTotal: number | null }> = {},
): Promise<string> => {
  const row = await db
    .insertInto('submissions')
    .values({
      user_id: userId,
      problem_id: problemId,
      language: 'python',
      source_code: 'print(1)',
      status: overrides.status ?? 'complete',
      verdict: (overrides.verdict ?? 'accepted') as never,
      tests_passed: overrides.testsPassed ?? 2,
      tests_total: overrides.testsTotal ?? 2,
      completed_at: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
};

afterAll(async () => {
  await migratorDb.deleteFrom('submissions').where('source_code', '=', 'print(1)').execute();
  await migratorDb.deleteFrom('problems').where('slug', 'like', 'history-test-%').execute();
  await migratorDb.deleteFrom('sessions').execute();
  await migratorDb.deleteFrom('users').where('email', 'like', 'history-test-%').execute();
  await migratorDb.destroy();
});

describe('GET /api/problems/:slug/submissions', () => {
  it('returns only the caller\'s own submissions, newest first, in summary shape', async () => {
    const { app, db } = await buildTestApp();
    const slug = `history-test-${randomUUID()}`;
    const problemId = await seedProblem(db, slug);

    const ownerEmail = uniqueEmail();
    const ownerCookie = await registerAndLogin(app, ownerEmail, 'a-fine-password');
    const owner = await db.selectFrom('users').select('id').where('email', '=', ownerEmail).executeTakeFirstOrThrow();

    const otherEmail = uniqueEmail();
    await registerAndLogin(app, otherEmail, 'a-fine-password');
    const other = await db.selectFrom('users').select('id').where('email', '=', otherEmail).executeTakeFirstOrThrow();

    const firstId = await insertSubmission(db, owner.id, problemId, { verdict: 'wrong_answer', testsPassed: 1, testsTotal: 2 });
    const secondId = await insertSubmission(db, owner.id, problemId, { verdict: 'accepted' });
    await insertSubmission(db, other.id, problemId, { verdict: 'accepted' });

    const response = await app.inject({
      method: 'GET',
      url: `/api/problems/${slug}/submissions`,
      cookies: { [ownerCookie.name]: ownerCookie.value },
    });

    expect(response.statusCode).toBe(200);
    const { submissions } = response.json();
    const ids = submissions.map((s: { id: string }) => s.id);
    expect(ids).toContain(firstId);
    expect(ids).toContain(secondId);
    expect(ids).toHaveLength(2);

    // newest first
    expect(submissions[0].id).toBe(secondId);
    expect(submissions[0]).toMatchObject({
      id: secondId,
      language: 'python',
      status: 'complete',
      verdict: 'accepted',
      testsPassed: 2,
      testsTotal: 2,
    });
    // no sourceCode field on the summary shape
    expect(submissions[0].sourceCode).toBeUndefined();
  });

  it('returns 401 for an anonymous caller', async () => {
    const { app, db } = await buildTestApp();
    const slug = `history-test-${randomUUID()}`;
    await seedProblem(db, slug);

    const response = await app.inject({ method: 'GET', url: `/api/problems/${slug}/submissions` });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 for an unknown problem slug', async () => {
    const { app } = await buildTestApp();
    const email = uniqueEmail();
    const cookie = await registerAndLogin(app, email, 'a-fine-password');

    const response = await app.inject({
      method: 'GET',
      url: '/api/problems/does-not-exist/submissions',
      cookies: { [cookie.name]: cookie.value },
    });
    expect(response.statusCode).toBe(404);
  });
});
