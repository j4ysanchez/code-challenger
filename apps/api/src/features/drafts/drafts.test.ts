import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { createLogger } from '../../platform/logger.js';
import { createDb, type Database } from '../../platform/db.js';
import type { Clock } from '../../platform/clock.js';
import { firstCookie, requireEnv } from '../../platform/test-env.js';
import { registerAuthRoutes } from '../auth/auth.js';
import { registerDraftsRoutes } from './drafts.js';
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

const uniqueEmail = (): string => `drafts-test-${randomUUID()}@example.com`;

const buildTestApp = async (): Promise<{ app: App; db: Kysely<Database> }> => {
  const db = createDb(databaseUrl);
  const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
  const clock = new FakeClock();
  registerAuthRoutes(app, { db, clock, config: testConfig });
  registerDraftsRoutes(app, { db, clock });
  return { app, db };
};

const registerAndLogin = async (app: App): Promise<{ name: string; value: string }> => {
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
  return firstCookie(login);
};

const seedPublishedProblem = async (db: Kysely<Database>, slug: string): Promise<void> => {
  await db
    .insertInto('problems')
    .values({ slug, title: 'Draft Test Problem', statement_md: '# s', difficulty: 'easy', status: 'published' })
    .execute();
};

afterAll(async () => {
  await migratorDb.deleteFrom('drafts').execute();
  await migratorDb.deleteFrom('audit_events').where('event_type', 'like', 'auth.%').execute();
  await migratorDb.deleteFrom('sessions').execute();
  await migratorDb.deleteFrom('problems').where('slug', 'like', 'drafts-test-%').execute();
  await migratorDb.deleteFrom('users').where('email', 'like', 'drafts-test-%').execute();
  await migratorDb.destroy();
});

describe('GET /api/problems/:slug/draft', () => {
  it('returns 401 without a session', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/problems/anything/draft?language=python' });
    expect(response.statusCode).toBe(401);
  });

  it('returns null when the caller has no saved draft', async () => {
    const { app, db } = await buildTestApp();
    const slug = `drafts-test-${randomUUID()}`;
    await seedPublishedProblem(db, slug);
    const cookie = await registerAndLogin(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/problems/${slug}/draft?language=python`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ draft: null });
  });

  it('returns 404 for an unknown problem slug', async () => {
    const { app } = await buildTestApp();
    const cookie = await registerAndLogin(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/problems/does-not-exist/draft?language=python',
      cookies: { [cookie.name]: cookie.value },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('PUT /api/problems/:slug/draft', () => {
  it('requires a session', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/problems/anything/draft',
      headers: withOrigin(),
      payload: { language: 'python', code: 'print(1)' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('upserts a draft that GET then returns, scoped to the owner', async () => {
    const { app, db } = await buildTestApp();
    const slug = `drafts-test-${randomUUID()}`;
    await seedPublishedProblem(db, slug);
    const cookie = await registerAndLogin(app);

    const put = await app.inject({
      method: 'PUT',
      url: `/api/problems/${slug}/draft`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: { language: 'python', code: 'print("draft v1")' },
    });
    expect(put.statusCode).toBe(204);

    const get1 = await app.inject({
      method: 'GET',
      url: `/api/problems/${slug}/draft?language=python`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(get1.json().draft.code).toBe('print("draft v1")');

    const putAgain = await app.inject({
      method: 'PUT',
      url: `/api/problems/${slug}/draft`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: { language: 'python', code: 'print("draft v2")' },
    });
    expect(putAgain.statusCode).toBe(204);

    const get2 = await app.inject({
      method: 'GET',
      url: `/api/problems/${slug}/draft?language=python`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(get2.json().draft.code).toBe('print("draft v2")');
  });

  it('keeps drafts isolated per user', async () => {
    const { app, db } = await buildTestApp();
    const slug = `drafts-test-${randomUUID()}`;
    await seedPublishedProblem(db, slug);
    const cookieA = await registerAndLogin(app);
    const cookieB = await registerAndLogin(app);

    await app.inject({
      method: 'PUT',
      url: `/api/problems/${slug}/draft`,
      headers: withOrigin(),
      cookies: { [cookieA.name]: cookieA.value },
      payload: { language: 'python', code: "print('user A')" },
    });

    const bResponse = await app.inject({
      method: 'GET',
      url: `/api/problems/${slug}/draft?language=python`,
      cookies: { [cookieB.name]: cookieB.value },
    });
    expect(bResponse.json()).toEqual({ draft: null });
  });

  it('keeps drafts isolated per language', async () => {
    const { app, db } = await buildTestApp();
    const slug = `drafts-test-${randomUUID()}`;
    await seedPublishedProblem(db, slug);
    const cookie = await registerAndLogin(app);

    await app.inject({
      method: 'PUT',
      url: `/api/problems/${slug}/draft`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: { language: 'python', code: 'print(1)' },
    });

    const jsDraft = await app.inject({
      method: 'GET',
      url: `/api/problems/${slug}/draft?language=javascript`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(jsDraft.json()).toEqual({ draft: null });
  });

  it('returns 422 for oversized code', async () => {
    const { app, db } = await buildTestApp();
    const slug = `drafts-test-${randomUUID()}`;
    await seedPublishedProblem(db, slug);
    const cookie = await registerAndLogin(app);

    const response = await app.inject({
      method: 'PUT',
      url: `/api/problems/${slug}/draft`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: { language: 'python', code: 'x'.repeat(101 * 1024) },
    });
    expect(response.statusCode).toBe(422);
  });
});
