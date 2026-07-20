import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { createLogger } from '../../platform/logger.js';
import { createDb, type Database } from '../../platform/db.js';
import type { Clock } from '../../platform/clock.js';
import { firstCookie, requireEnv } from '../../platform/test-env.js';
import { registerAuthRoutes } from '../auth/auth.js';
import { registerProblemsRoutes } from '../problems/problems.js';
import { registerAdminProblemsRoutes } from './admin-problems.js';
import { registerPublishRoutes } from './publish.js';
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

const uniqueEmail = (): string => `publish-test-${randomUUID()}@example.com`;

const buildTestApp = async (): Promise<{ app: App; db: Kysely<Database> }> => {
  const db = createDb(databaseUrl);
  const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
  const clock = new FakeClock();
  registerAuthRoutes(app, { db, clock, config: testConfig });
  registerProblemsRoutes(app, { db, clock });
  registerAdminProblemsRoutes(app, { db, clock });
  registerPublishRoutes(app, { db, clock });
  return { app, db };
};

const registerAdminAndLogin = async (app: App, db: Kysely<Database>): Promise<{ name: string; value: string }> => {
  const email = uniqueEmail();
  await app.inject({ method: 'POST', url: '/api/auth/register', headers: withOrigin(), payload: { email, password: 'a-fine-password' } });
  await db.updateTable('users').set({ role: 'admin' }).where('email', '=', email).execute();
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: withOrigin(), payload: { email, password: 'a-fine-password' } });
  return firstCookie(login);
};

const createDraftProblem = async (app: App, cookie: { name: string; value: string }, slug: string): Promise<string> => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/admin/problems',
    headers: withOrigin(),
    cookies: { [cookie.name]: cookie.value },
    payload: {
      slug,
      title: 'Publish Test',
      statementMd: '# s',
      difficulty: 'easy' as const,
      tags: [],
      limits: { cpuTimeLimitMs: 2000, wallTimeLimitMs: 10000, memoryLimitMb: 256 },
      starterCode: { python: 'pass', javascript: '// starter' },
    },
  });
  return response.json().problem.id as string;
};

afterAll(async () => {
  await migratorDb.deleteFrom('test_cases').where('problem_id', 'in', (eb) =>
    eb.selectFrom('problems').select('id').where('slug', 'like', 'publish-test-%'),
  ).execute();
  await migratorDb.deleteFrom('starter_code').where('problem_id', 'in', (eb) =>
    eb.selectFrom('problems').select('id').where('slug', 'like', 'publish-test-%'),
  ).execute();
  await migratorDb.deleteFrom('problems').where('slug', 'like', 'publish-test-%').execute();
  await migratorDb.deleteFrom('audit_events').where('event_type', 'like', 'auth.%').execute();
  await migratorDb.deleteFrom('audit_events').where('event_type', 'like', 'problem.%').execute();
  await migratorDb.deleteFrom('sessions').execute();
  await migratorDb.deleteFrom('users').where('email', 'like', 'publish-test-%').execute();
  await migratorDb.destroy();
});

describe('POST /api/admin/problems/:id/publish', () => {
  it('returns 422 unless the problem has at least one visible and one hidden test case', async () => {
    const { app, db } = await buildTestApp();
    const cookie = await registerAdminAndLogin(app, db);
    const slug = `publish-test-${randomUUID()}`;
    const id = await createDraftProblem(app, cookie, slug);

    const noCases = await app.inject({
      method: 'POST',
      url: `/api/admin/problems/${id}/publish`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
    });
    expect(noCases.statusCode).toBe(422);

    await app.inject({
      method: 'PUT',
      url: `/api/admin/problems/${id}/test-cases`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: { testCases: [{ input: 'x', expectedOutput: 'y', visible: true }] },
    });
    const onlyVisible = await app.inject({
      method: 'POST',
      url: `/api/admin/problems/${id}/publish`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
    });
    expect(onlyVisible.statusCode).toBe(422);
  });

  it('publishes when >=1 visible and >=1 hidden case exist, and records a problem.published audit event', async () => {
    const { app, db } = await buildTestApp();
    const cookie = await registerAdminAndLogin(app, db);
    const slug = `publish-test-${randomUUID()}`;
    const id = await createDraftProblem(app, cookie, slug);
    await app.inject({
      method: 'PUT',
      url: `/api/admin/problems/${id}/test-cases`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: {
        testCases: [
          { input: 'x', expectedOutput: 'y', visible: true },
          { input: 'a', expectedOutput: 'b', visible: false },
        ],
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/problems/${id}/publish`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
    });
    expect(response.statusCode).toBe(204);

    const problem = await db.selectFrom('problems').select('status').where('id', '=', id).executeTakeFirstOrThrow();
    expect(problem.status).toBe('published');

    const audit = await db
      .selectFrom('audit_events')
      .selectAll()
      .where('event_type', '=', 'problem.published')
      .where('data', '@>', JSON.stringify({ problemId: id }))
      .executeTakeFirst();
    expect(audit).toBeDefined();
  });

  it('returns 404 for an unknown problem id', async () => {
    const { app, db } = await buildTestApp();
    const cookie = await registerAdminAndLogin(app, db);
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/problems/00000000-0000-0000-0000-000000000000/publish',
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /api/admin/problems/:id/unpublish', () => {
  it('reverts a published problem to draft', async () => {
    const { app, db } = await buildTestApp();
    const cookie = await registerAdminAndLogin(app, db);
    const slug = `publish-test-${randomUUID()}`;
    const id = await createDraftProblem(app, cookie, slug);
    await app.inject({
      method: 'PUT',
      url: `/api/admin/problems/${id}/test-cases`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: {
        testCases: [
          { input: 'x', expectedOutput: 'y', visible: true },
          { input: 'a', expectedOutput: 'b', visible: false },
        ],
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/admin/problems/${id}/publish`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/problems/${id}/unpublish`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
    });
    expect(response.statusCode).toBe(204);

    const problem = await db.selectFrom('problems').select('status').where('id', '=', id).executeTakeFirstOrThrow();
    expect(problem.status).toBe('draft');

    const publicRead = await app.inject({ method: 'GET', url: `/api/problems/${slug}` });
    expect(publicRead.statusCode).toBe(404);
  });

  it('returns 404 for an unknown problem id', async () => {
    const { app, db } = await buildTestApp();
    const cookie = await registerAdminAndLogin(app, db);
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/problems/00000000-0000-0000-0000-000000000000/unpublish',
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
    });
    expect(response.statusCode).toBe(404);
  });
});
