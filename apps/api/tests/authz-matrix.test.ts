import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../src/app.js';
import { createLogger } from '../src/platform/logger.js';
import { createDb, type Database } from '../src/platform/db.js';
import type { Clock } from '../src/platform/clock.js';
import { firstCookie, requireEnv } from '../src/platform/test-env.js';
import { registerAuthRoutes } from '../src/features/auth/auth.js';
import { registerDraftsRoutes } from '../src/features/drafts/drafts.js';
import { registerCreateSubmissionRoute } from '../src/features/submissions/create.js';
import { registerSubmissionDetailRoute } from '../src/features/submissions/detail.js';
import { registerHistoryRoute } from '../src/features/submissions/history.js';
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

const uniqueEmail = (): string => `authz-matrix-test-${randomUUID()}@example.com`;

const withOrigin = (headers: Record<string, string> = {}): Record<string, string> => ({
  origin: testConfig.appOrigin,
  ...headers,
});

interface TestApp {
  readonly app: App;
  readonly db: Kysely<Database>;
}

/** Full member-route surface wired together, mirroring index.ts, for a cross-slice matrix. */
const buildTestApp = async (): Promise<TestApp> => {
  const db = createDb(databaseUrl);
  const clock = new FakeClock();
  const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
  registerAuthRoutes(app, { db, clock, config: testConfig });
  registerDraftsRoutes(app, { db, clock });
  registerCreateSubmissionRoute(app, { db, clock, enqueue: vi.fn(async () => undefined) });
  registerSubmissionDetailRoute(app, { db, clock });
  registerHistoryRoute(app, { db, clock });
  return { app, db };
};

const registerAndLogin = async (app: App, email: string): Promise<{ name: string; value: string }> => {
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
  return firstCookie(login);
};

const seedPublishedProblem = async (db: Kysely<Database>, slug: string): Promise<string> => {
  const row = await db
    .insertInto('problems')
    .values({ slug, title: 'Authz Matrix Test', statement_md: '# s', difficulty: 'easy', status: 'published' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
};

afterAll(async () => {
  await migratorDb
    .deleteFrom('drafts')
    .where('problem_id', 'in', (eb) => eb.selectFrom('problems').select('id').where('slug', 'like', 'authz-matrix-test-%'))
    .execute();
  await migratorDb
    .deleteFrom('submissions')
    .where('user_id', 'in', (eb) => eb.selectFrom('users').select('id').where('email', 'like', 'authz-matrix-test-%'))
    .execute();
  await migratorDb.deleteFrom('audit_events').where('event_type', 'like', 'auth.%').execute();
  await migratorDb.deleteFrom('audit_events').where('event_type', '=', 'submission.created').execute();
  await migratorDb.deleteFrom('sessions').execute();
  await migratorDb.deleteFrom('problems').where('slug', 'like', 'authz-matrix-test-%').execute();
  await migratorDb.deleteFrom('users').where('email', 'like', 'authz-matrix-test-%').execute();
  await migratorDb.destroy();
});

describe('authorization matrix: anonymous requests to member routes', () => {
  it.each([
    { method: 'POST' as const, url: '/api/auth/logout' },
    { method: 'GET' as const, url: '/api/auth/me' },
    { method: 'GET' as const, url: '/api/problems/anything/draft?language=python' },
    { method: 'PUT' as const, url: '/api/problems/anything/draft' },
    { method: 'POST' as const, url: '/api/problems/anything/submissions' },
    { method: 'GET' as const, url: '/api/submissions/00000000-0000-0000-0000-000000000000' },
    { method: 'GET' as const, url: '/api/problems/anything/submissions' },
  ])('$method $url denies an anonymous caller with 401 (deny-by-default)', async ({ method, url }) => {
    const { app } = await buildTestApp();
    const response = await app.inject(
      method === 'POST' || method === 'PUT'
        ? { method, url, headers: withOrigin(), payload: {} }
        : { method, url, headers: withOrigin() },
    );
    expect(response.statusCode).toBe(401);
  });
});

describe('authorization matrix: cross-user ownership', () => {
  it('user B reading user A\'s submission id gets 404, indistinguishable from missing (FR-012)', async () => {
    const { app, db } = await buildTestApp();
    const slug = `authz-matrix-test-${randomUUID()}`;
    const problemId = await seedPublishedProblem(db, slug);

    const ownerCookie = await registerAndLogin(app, uniqueEmail());
    const ownerEmail = (await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [ownerCookie.name]: ownerCookie.value } })).json()
      .user.email as string;
    const owner = await db.selectFrom('users').select('id').where('email', '=', ownerEmail).executeTakeFirstOrThrow();

    const submission = await db
      .insertInto('submissions')
      .values({ user_id: owner.id, problem_id: problemId, language: 'python', source_code: 'print(1)' })
      .returning('id')
      .executeTakeFirstOrThrow();

    const otherCookie = await registerAndLogin(app, uniqueEmail());

    const ownerRead = await app.inject({
      method: 'GET',
      url: `/api/submissions/${submission.id}`,
      cookies: { [ownerCookie.name]: ownerCookie.value },
    });
    expect(ownerRead.statusCode).toBe(200);

    const otherRead = await app.inject({
      method: 'GET',
      url: `/api/submissions/${submission.id}`,
      cookies: { [otherCookie.name]: otherCookie.value },
    });
    expect(otherRead.statusCode).toBe(404);
    expect(otherRead.json()).toEqual({ error: { code: 'not_found', message: expect.any(String) } });

    const missingRead = await app.inject({
      method: 'GET',
      url: '/api/submissions/00000000-0000-0000-0000-000000000000',
      cookies: { [otherCookie.name]: otherCookie.value },
    });
    expect(missingRead.json()).toEqual(otherRead.json());
  });

  it('user B\'s submission history for a problem never includes user A\'s submissions', async () => {
    const { app, db } = await buildTestApp();
    const slug = `authz-matrix-test-${randomUUID()}`;
    const problemId = await seedPublishedProblem(db, slug);

    const ownerCookie = await registerAndLogin(app, uniqueEmail());
    const ownerEmail = (await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [ownerCookie.name]: ownerCookie.value } })).json()
      .user.email as string;
    const owner = await db.selectFrom('users').select('id').where('email', '=', ownerEmail).executeTakeFirstOrThrow();
    await db
      .insertInto('submissions')
      .values({ user_id: owner.id, problem_id: problemId, language: 'python', source_code: 'print(1)' })
      .execute();

    const otherCookie = await registerAndLogin(app, uniqueEmail());
    const otherHistory = await app.inject({
      method: 'GET',
      url: `/api/problems/${slug}/submissions`,
      cookies: { [otherCookie.name]: otherCookie.value },
    });
    expect(otherHistory.statusCode).toBe(200);
    expect(otherHistory.json().submissions).toEqual([]);
  });

  it('user B\'s draft read never returns user A\'s draft for the same problem+language', async () => {
    const { app, db } = await buildTestApp();
    const slug = `authz-matrix-test-${randomUUID()}`;
    await seedPublishedProblem(db, slug);

    const ownerCookie = await registerAndLogin(app, uniqueEmail());
    await app.inject({
      method: 'PUT',
      url: `/api/problems/${slug}/draft`,
      headers: withOrigin(),
      cookies: { [ownerCookie.name]: ownerCookie.value },
      payload: { language: 'python', code: 'owner secret draft' },
    });

    const otherCookie = await registerAndLogin(app, uniqueEmail());
    const otherDraft = await app.inject({
      method: 'GET',
      url: `/api/problems/${slug}/draft?language=python`,
      cookies: { [otherCookie.name]: otherCookie.value },
    });
    expect(otherDraft.statusCode).toBe(200);
    expect(otherDraft.json()).toEqual({ draft: null });
  });
});
