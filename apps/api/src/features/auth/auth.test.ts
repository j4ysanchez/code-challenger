import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { createLogger } from '../../platform/logger.js';
import { createDb, type Database } from '../../platform/db.js';
import type { Clock } from '../../platform/clock.js';
import { SESSION_COOKIE_NAME } from '../../platform/sessions.js';
import { firstCookie, requireEnv } from '../../platform/test-env.js';
import { registerAuthRoutes } from './auth.js';
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

const uniqueEmail = (): string => `auth-test-${Math.random().toString(36).slice(2)}@example.com`;

const buildTestApp = async (): Promise<{ app: App; db: Kysely<Database> }> => {
  const db = createDb(databaseUrl);
  const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
  registerAuthRoutes(app, { db, clock: new FakeClock(new Date()), config: testConfig });
  return { app, db };
};

const withOrigin = (headers: Record<string, string> = {}): Record<string, string> => ({
  origin: testConfig.appOrigin,
  ...headers,
});

afterAll(async () => {
  await migratorDb.deleteFrom('audit_events').where('event_type', 'like', 'auth.%').execute();
  await migratorDb.deleteFrom('sessions').execute();
  await migratorDb.deleteFrom('users').where('email', 'like', 'auth-test-%').execute();
  await migratorDb.destroy();
});

describe('POST /api/auth/register', () => {
  it('creates a member user with an argon2id password hash', async () => {
    const { app, db } = await buildTestApp();
    const email = uniqueEmail();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: withOrigin(),
      payload: { email, password: 'a-fine-password' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.user).toEqual({ id: expect.any(String), email, role: 'member' });

    const row = await db
      .selectFrom('users')
      .select(['password_hash'])
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    expect(row.password_hash).toMatch(/^\$argon2id\$/);

    const auditRow = await db
      .selectFrom('audit_events')
      .selectAll()
      .where('event_type', '=', 'auth.register')
      .where('user_id', '=', body.user.id)
      .executeTakeFirst();
    expect(auditRow).toBeDefined();
  });

  it('returns 409 conflict when the email is already registered', async () => {
    const { app } = await buildTestApp();
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: withOrigin(),
      payload: { email, password: 'a-fine-password' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: withOrigin(),
      payload: { email, password: 'a-different-password' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: 'conflict', message: expect.any(String) } });
  });

  it('treats email uniqueness as case-insensitive', async () => {
    const { app } = await buildTestApp();
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: withOrigin(),
      payload: { email, password: 'a-fine-password' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: withOrigin(),
      payload: { email: email.toUpperCase(), password: 'a-fine-password' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('returns 422 validation_failed for a malformed request', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: withOrigin(),
      payload: { email: 'not-an-email', password: 'short' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: { code: 'validation_failed', message: expect.any(String) },
    });
  });
});

describe('POST /api/auth/login', () => {
  const registerUser = async (app: App, email: string, password: string): Promise<void> => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: withOrigin(),
      payload: { email, password },
    });
  };

  it('logs in with correct credentials and sets the sid cookie', async () => {
    const { app, db } = await buildTestApp();
    const email = uniqueEmail();
    await registerUser(app, email, 'correct-password');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: withOrigin(),
      payload: { email, password: 'correct-password' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe(email);
    const setCookie = response.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieHeader).toContain(`${SESSION_COOKIE_NAME}=`);

    const auditRow = await db
      .selectFrom('audit_events')
      .selectAll()
      .where('event_type', '=', 'auth.login')
      .executeTakeFirst();
    expect(auditRow).toBeDefined();
  });

  it('returns the same 401 message for an unknown email and a wrong password (no enumeration)', async () => {
    const { app } = await buildTestApp();
    const email = uniqueEmail();
    await registerUser(app, email, 'correct-password');

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: withOrigin(),
      payload: { email, password: 'totally-wrong' },
    });
    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: withOrigin(),
      payload: { email: uniqueEmail(), password: 'totally-wrong' },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
  });

  it('writes an auth.login_failed audit event on bad credentials', async () => {
    const { app, db } = await buildTestApp();
    const email = uniqueEmail();
    await registerUser(app, email, 'correct-password');
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: withOrigin(),
      payload: { email, password: 'wrong' },
    });

    const auditRow = await db
      .selectFrom('audit_events')
      .selectAll()
      .where('event_type', '=', 'auth.login_failed')
      .executeTakeFirst();
    expect(auditRow).toBeDefined();
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a session', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
  });

  it('returns the current user with a valid session cookie', async () => {
    const { app } = await buildTestApp();
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: withOrigin(),
      payload: { email, password: 'correct-password' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: withOrigin(),
      payload: { email, password: 'correct-password' },
    });
    const cookie = firstCookie(login);

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [cookie.name]: cookie.value },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe(email);
  });
});

describe('POST /api/auth/logout', () => {
  it('requires an active session (401 otherwise)', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: withOrigin() });
    expect(response.statusCode).toBe(401);
  });

  it('revokes the session server-side and clears the cookie', async () => {
    const { app, db } = await buildTestApp();
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: withOrigin(),
      payload: { email, password: 'correct-password' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: withOrigin(),
      payload: { email, password: 'correct-password' },
    });
    const cookie = firstCookie(login);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: withOrigin(),
      cookies: { [cookie.name]: cookie.value },
    });
    expect(logout.statusCode).toBe(204);

    const auditRow = await db
      .selectFrom('audit_events')
      .selectAll()
      .where('event_type', '=', 'auth.logout')
      .executeTakeFirst();
    expect(auditRow).toBeDefined();

    const meAfterLogout = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [cookie.name]: cookie.value },
    });
    expect(meAfterLogout.statusCode).toBe(401);
  });
});
