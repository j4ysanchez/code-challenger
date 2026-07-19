import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { createLogger } from '../../platform/logger.js';
import { createDb, type Database } from '../../platform/db.js';
import type { Clock } from '../../platform/clock.js';
import { firstCookie, requireEnv } from '../../platform/test-env.js';
import { registerAuthRoutes } from '../auth/auth.js';
import { registerCreateSubmissionRoute } from './create.js';
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

const uniqueEmail = (): string => `submissions-create-test-${randomUUID()}@example.com`;

interface TestApp {
  readonly app: App;
  readonly db: Kysely<Database>;
  readonly enqueue: ReturnType<typeof vi.fn>;
}

const buildTestApp = async (): Promise<TestApp> => {
  const db = createDb(databaseUrl);
  const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
  const clock = new FakeClock();
  registerAuthRoutes(app, { db, clock, config: testConfig });
  const enqueue = vi.fn(async () => undefined);
  registerCreateSubmissionRoute(app, { db, clock, enqueue });
  return { app, db, enqueue };
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

const seedPublishedProblem = async (db: Kysely<Database>, slug: string): Promise<string> => {
  const row = await db
    .insertInto('problems')
    .values({ slug, title: 'Create Submission Test', statement_md: '# s', difficulty: 'easy', status: 'published' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
};

afterAll(async () => {
  await migratorDb.deleteFrom('submissions').where('user_id', 'in', (eb) =>
    eb.selectFrom('users').select('id').where('email', 'like', 'submissions-create-test-%'),
  ).execute();
  await migratorDb.deleteFrom('audit_events').where('event_type', 'like', 'auth.%').execute();
  await migratorDb.deleteFrom('audit_events').where('event_type', '=', 'submission.created').execute();
  await migratorDb.deleteFrom('sessions').execute();
  await migratorDb.deleteFrom('problems').where('slug', 'like', 'submissions-create-test-%').execute();
  await migratorDb.deleteFrom('users').where('email', 'like', 'submissions-create-test-%').execute();
  await migratorDb.destroy();
});

describe('POST /api/problems/:slug/submissions', () => {
  it('requires a session', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/problems/anything/submissions',
      headers: withOrigin(),
      payload: { language: 'python', source: 'print(1)' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 422 for an invalid language before touching the database', async () => {
    const { app, db } = await buildTestApp();
    const slug = `submissions-create-test-${randomUUID()}`;
    await seedPublishedProblem(db, slug);
    const cookie = await registerAndLogin(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/problems/${slug}/submissions`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: { language: 'ruby', source: 'puts 1' },
    });
    expect(response.statusCode).toBe(422);
  });

  it('returns 422 for oversized source', async () => {
    const { app, db } = await buildTestApp();
    const slug = `submissions-create-test-${randomUUID()}`;
    await seedPublishedProblem(db, slug);
    const cookie = await registerAndLogin(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/problems/${slug}/submissions`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: { language: 'python', source: 'x'.repeat(101 * 1024) },
    });
    expect(response.statusCode).toBe(422);
  });

  it('returns 404 for an unknown problem slug', async () => {
    const { app } = await buildTestApp();
    const cookie = await registerAndLogin(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/problems/does-not-exist/submissions',
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: { language: 'python', source: 'print(1)' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('inserts a queued row, enqueues a job, and audits the creation', async () => {
    const { app, db, enqueue } = await buildTestApp();
    const slug = `submissions-create-test-${randomUUID()}`;
    await seedPublishedProblem(db, slug);
    const cookie = await registerAndLogin(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/problems/${slug}/submissions`,
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
      payload: { language: 'python', source: 'print(1)' },
    });
    expect(response.statusCode).toBe(202);
    const { submission } = response.json();
    expect(submission.status).toBe('queued');

    const row = await db.selectFrom('submissions').selectAll().where('id', '=', submission.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('queued');
    expect(row.source_code).toBe('print(1)');

    expect(enqueue).toHaveBeenCalledExactlyOnceWith({ submissionId: submission.id });

    const auditRow = await db
      .selectFrom('audit_events')
      .selectAll()
      .where('event_type', '=', 'submission.created')
      .where('user_id', '=', row.user_id)
      .executeTakeFirst();
    expect(auditRow).toBeDefined();
  });

  it('rate-limits a user at 6 submissions per minute with Retry-After on the 7th', async () => {
    const { app, db } = await buildTestApp();
    const slug = `submissions-create-test-${randomUUID()}`;
    await seedPublishedProblem(db, slug);
    const cookie = await registerAndLogin(app);

    const submit = () =>
      app.inject({
        method: 'POST',
        url: `/api/problems/${slug}/submissions`,
        headers: withOrigin(),
        cookies: { [cookie.name]: cookie.value },
        payload: { language: 'python', source: 'print(1)' },
      });

    const responses = await Array.from({ length: 7 }).reduce(
      async (accPromise: Promise<Awaited<ReturnType<typeof submit>>[]>) => {
        const acc = await accPromise;
        const response = await submit();
        return [...acc, response];
      },
      Promise.resolve([]),
    );

    const statusCodes = responses.map((r) => r.statusCode);
    expect(statusCodes.slice(0, 6)).toEqual(Array.from({ length: 6 }, () => 202));
    expect(statusCodes[6]).toBe(429);
    expect(responses[6]?.headers['retry-after']).toBe('60');
    expect(responses[6]?.json()).toEqual({ error: { code: 'rate_limited', message: expect.any(String) } });
  });
});
