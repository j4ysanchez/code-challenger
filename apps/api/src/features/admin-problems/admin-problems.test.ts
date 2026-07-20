import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { createLogger } from '../../platform/logger.js';
import { createDb, type Database } from '../../platform/db.js';
import type { Clock } from '../../platform/clock.js';
import { firstCookie, requireEnv } from '../../platform/test-env.js';
import { registerAuthRoutes } from '../auth/auth.js';
import { registerAdminProblemsRoutes } from './admin-problems.js';
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

const uniqueEmail = (): string => `admin-problems-test-${randomUUID()}@example.com`;

const buildTestApp = async (): Promise<{ app: App; db: Kysely<Database> }> => {
  const db = createDb(databaseUrl);
  const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
  const clock = new FakeClock();
  registerAuthRoutes(app, { db, clock, config: testConfig });
  registerAdminProblemsRoutes(app, { db, clock });
  return { app, db };
};

const registerAdminAndLogin = async (app: App, db: Kysely<Database>): Promise<{ name: string; value: string }> => {
  const email = uniqueEmail();
  await app.inject({ method: 'POST', url: '/api/auth/register', headers: withOrigin(), payload: { email, password: 'a-fine-password' } });
  await db.updateTable('users').set({ role: 'admin' }).where('email', '=', email).execute();
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: withOrigin(), payload: { email, password: 'a-fine-password' } });
  return firstCookie(login);
};

const validPayload = (slug: string) => ({
  slug,
  title: 'Two Sum',
  statementMd: '# Two Sum\n\nAdd two numbers.',
  difficulty: 'easy' as const,
  tags: ['math'],
  limits: { cpuTimeLimitMs: 2000, wallTimeLimitMs: 10000, memoryLimitMb: 256 },
  starterCode: { python: 'pass', javascript: '// starter' },
});

afterAll(async () => {
  await migratorDb.deleteFrom('test_cases').where('problem_id', 'in', (eb) =>
    eb.selectFrom('problems').select('id').where('slug', 'like', 'admin-problems-test-%'),
  ).execute();
  await migratorDb.deleteFrom('starter_code').where('problem_id', 'in', (eb) =>
    eb.selectFrom('problems').select('id').where('slug', 'like', 'admin-problems-test-%'),
  ).execute();
  await migratorDb.deleteFrom('problems').where('slug', 'like', 'admin-problems-test-%').execute();
  await migratorDb.deleteFrom('audit_events').where('event_type', 'like', 'auth.%').execute();
  await migratorDb.deleteFrom('sessions').execute();
  await migratorDb.deleteFrom('users').where('email', 'like', 'admin-problems-test-%').execute();
  await migratorDb.destroy();
});

describe('POST /api/admin/problems', () => {
  it('creates a draft problem with starter code', async () => {
    const { app, db } = await buildTestApp();
    const cookie = await registerAdminAndLogin(app, db);
    const slug = `admin-problems-test-${randomUUID()}`;

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/problems',
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: validPayload(slug),
    });

    expect(response.statusCode).toBe(201);
    const { problem } = response.json();
    expect(problem.slug).toBe(slug);
    expect(problem.status).toBe('draft');
    expect(problem.starterCode).toEqual({ python: 'pass', javascript: '// starter' });
  });

  it('returns 409 for a duplicate slug', async () => {
    const { app, db } = await buildTestApp();
    const cookie = await registerAdminAndLogin(app, db);
    const slug = `admin-problems-test-${randomUUID()}`;

    await app.inject({
      method: 'POST',
      url: '/api/admin/problems',
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: validPayload(slug),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/problems',
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: validPayload(slug),
    });

    expect(response.statusCode).toBe(409);
  });

  it('returns 422 for an invalid payload (bad slug)', async () => {
    const { app, db } = await buildTestApp();
    const cookie = await registerAdminAndLogin(app, db);

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/problems',
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: validPayload('NOT A SLUG'),
    });

    expect(response.statusCode).toBe(422);
  });
});

describe('PATCH /api/admin/problems/:id', () => {
  it('partially updates title and limits', async () => {
    const { app, db } = await buildTestApp();
    const cookie = await registerAdminAndLogin(app, db);
    const slug = `admin-problems-test-${randomUUID()}`;
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/problems',
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: validPayload(slug),
    });
    const { id } = created.json().problem;

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/problems/${id}`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: { title: 'Updated Title', limits: { cpuTimeLimitMs: 3000, wallTimeLimitMs: 15000, memoryLimitMb: 512 } },
    });

    expect(response.statusCode).toBe(200);
    const { problem } = response.json();
    expect(problem.title).toBe('Updated Title');
    expect(problem.limits).toEqual({ cpuTimeLimitMs: 3000, wallTimeLimitMs: 15000, memoryLimitMb: 512 });
    expect(problem.slug).toBe(slug);
  });

  it('returns 404 for an unknown problem id', async () => {
    const { app, db } = await buildTestApp();
    const cookie = await registerAdminAndLogin(app, db);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/admin/problems/00000000-0000-0000-0000-000000000000',
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: { title: 'Nope' },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('PUT /api/admin/problems/:id/test-cases', () => {
  it('replaces test cases in full, ordered', async () => {
    const { app, db } = await buildTestApp();
    const cookie = await registerAdminAndLogin(app, db);
    const slug = `admin-problems-test-${randomUUID()}`;
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/problems',
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: validPayload(slug),
    });
    const { id } = created.json().problem;

    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/problems/${id}/test-cases`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: {
        testCases: [
          { input: '2 3', expectedOutput: '5', visible: true },
          { input: '10 15', expectedOutput: '25', visible: false },
        ],
      },
    });
    expect(response.statusCode).toBe(204);

    const testCases = await db
      .selectFrom('test_cases')
      .select(['position', 'input', 'expected_output', 'visible'])
      .where('problem_id', '=', id)
      .orderBy('position', 'asc')
      .execute();
    expect(testCases).toEqual([
      { position: 0, input: '2 3', expected_output: '5', visible: true },
      { position: 1, input: '10 15', expected_output: '25', visible: false },
    ]);

    // Replacing again fully discards the previous set (not additive).
    const secondReplace = await app.inject({
      method: 'PUT',
      url: `/api/admin/problems/${id}/test-cases`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: { testCases: [{ input: 'x', expectedOutput: 'y', visible: true }] },
    });
    expect(secondReplace.statusCode).toBe(204);
    const afterSecond = await db.selectFrom('test_cases').select('input').where('problem_id', '=', id).execute();
    expect(afterSecond).toEqual([{ input: 'x' }]);
  });

  it('returns 404 for an unknown problem id', async () => {
    const { app, db } = await buildTestApp();
    const cookie = await registerAdminAndLogin(app, db);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/problems/00000000-0000-0000-0000-000000000000/test-cases',
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: { testCases: [{ input: 'x', expectedOutput: 'y', visible: true }] },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/admin/problems', () => {
  it('includes drafts (unlike the public catalog)', async () => {
    const { app, db } = await buildTestApp();
    const cookie = await registerAdminAndLogin(app, db);
    const slug = `admin-problems-test-${randomUUID()}`;
    await app.inject({
      method: 'POST',
      url: '/api/admin/problems',
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: validPayload(slug),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/problems',
      cookies: { [cookie.name]: cookie.value },
    });

    expect(response.statusCode).toBe(200);
    const slugs = response.json().problems.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain(slug);
  });
});
