import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.js';
import { createLogger } from '../src/platform/logger.js';
import { createDb, type Database } from '../src/platform/db.js';
import type { Clock } from '../src/platform/clock.js';
import { firstCookie, requireEnv } from '../src/platform/test-env.js';
import { registerAuthRoutes } from '../src/features/auth/auth.js';
import { registerAdminProblemsRoutes } from '../src/features/admin-problems/admin-problems.js';
import { registerPublishRoutes } from '../src/features/admin-problems/publish.js';
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

const uniqueEmail = (): string => `admin-authz-test-${randomUUID()}@example.com`;

const withOrigin = (headers: Record<string, string> = {}): Record<string, string> => ({
  origin: testConfig.appOrigin,
  ...headers,
});

/** Full admin-route surface wired together, mirroring index.ts, for the authorization matrix. */
const buildTestApp = async (): Promise<{ app: App; db: Kysely<Database> }> => {
  const db = createDb(databaseUrl);
  const clock = new FakeClock();
  const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
  registerAuthRoutes(app, { db, clock, config: testConfig });
  registerAdminProblemsRoutes(app, { db, clock });
  registerPublishRoutes(app, { db, clock });
  return { app, db };
};

const registerAndLogin = async (
  app: App,
  email: string,
  password = 'a-fine-password',
): Promise<{ name: string; value: string }> => {
  await app.inject({ method: 'POST', url: '/api/auth/register', headers: withOrigin(), payload: { email, password } });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: withOrigin(),
    payload: { email, password },
  });
  return firstCookie(login);
};

const promoteToAdmin = async (db: Kysely<Database>, email: string): Promise<void> => {
  await db.updateTable('users').set({ role: 'admin' }).where('email', '=', email).execute();
};

const validProblemPayload = (slug: string) => ({
  slug,
  title: 'Admin Authz Test',
  statementMd: '# statement',
  difficulty: 'easy' as const,
  tags: [],
  limits: { cpuTimeLimitMs: 2000, wallTimeLimitMs: 10000, memoryLimitMb: 256 },
  starterCode: { python: 'pass', javascript: '// starter' },
});

afterAll(async () => {
  await migratorDb.deleteFrom('test_cases').where('problem_id', 'in', (eb) =>
    eb.selectFrom('problems').select('id').where('slug', 'like', 'admin-authz-test-%'),
  ).execute();
  await migratorDb.deleteFrom('starter_code').where('problem_id', 'in', (eb) =>
    eb.selectFrom('problems').select('id').where('slug', 'like', 'admin-authz-test-%'),
  ).execute();
  await migratorDb.deleteFrom('problems').where('slug', 'like', 'admin-authz-test-%').execute();
  await migratorDb.deleteFrom('audit_events').where('event_type', 'like', 'auth.%').execute();
  await migratorDb.deleteFrom('audit_events').where('event_type', 'like', 'problem.%').execute();
  await migratorDb.deleteFrom('sessions').execute();
  await migratorDb.deleteFrom('users').where('email', 'like', 'admin-authz-test-%').execute();
  await migratorDb.destroy();
});

const ADMIN_ROUTES = [
  { method: 'GET' as const, url: '/api/admin/problems' },
  { method: 'POST' as const, url: '/api/admin/problems' },
  { method: 'PATCH' as const, url: '/api/admin/problems/00000000-0000-0000-0000-000000000000' },
  { method: 'PUT' as const, url: '/api/admin/problems/00000000-0000-0000-0000-000000000000/test-cases' },
  { method: 'POST' as const, url: '/api/admin/problems/00000000-0000-0000-0000-000000000000/publish' },
  { method: 'POST' as const, url: '/api/admin/problems/00000000-0000-0000-0000-000000000000/unpublish' },
];

describe('admin authorization matrix: anonymous callers', () => {
  it.each(ADMIN_ROUTES)('$method $url denies an anonymous caller with 401 (deny-by-default)', async ({ method, url }) => {
    const { app } = await buildTestApp();
    const response = await app.inject(
      method === 'GET' ? { method, url, headers: withOrigin() } : { method, url, headers: withOrigin(), payload: {} },
    );
    expect(response.statusCode).toBe(401);
  });
});

describe('admin authorization matrix: authenticated non-admin (member) callers', () => {
  it.each(ADMIN_ROUTES)('$method $url denies a member caller with 403 (forbidden)', async ({ method, url }) => {
    const { app } = await buildTestApp();
    const cookie = await registerAndLogin(app, uniqueEmail());

    const response = await app.inject(
      method === 'GET'
        ? { method, url, headers: withOrigin(), cookies: { [cookie.name]: cookie.value } }
        : { method, url, headers: withOrigin(), cookies: { [cookie.name]: cookie.value }, payload: {} },
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: 'forbidden', message: expect.any(String) } });
  });
});

describe('admin authorization: an admin caller is let through', () => {
  it('GET /api/admin/problems succeeds (200) for an admin session', async () => {
    const { app, db } = await buildTestApp();
    const email = uniqueEmail();
    const cookie = await registerAndLogin(app, email);
    await promoteToAdmin(db, email);

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/problems',
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
    });
    expect(response.statusCode).toBe(200);
  });

  it('POST /api/admin/problems succeeds (201) for an admin session', async () => {
    const { app, db } = await buildTestApp();
    const email = uniqueEmail();
    const cookie = await registerAndLogin(app, email);
    await promoteToAdmin(db, email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/problems',
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: validProblemPayload(`admin-authz-test-${randomUUID()}`),
    });
    expect(response.statusCode).toBe(201);
  });
});
