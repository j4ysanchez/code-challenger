import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { createLogger } from '../../platform/logger.js';
import { createDb, type Database } from '../../platform/db.js';
import type { Clock } from '../../platform/clock.js';
import { createLogCapture, findLogEvent, firstCookie, requireEnv } from '../../platform/test-env.js';
import { registerAuthRoutes } from './auth.js';
import { registerPasswordResetRoutes } from './password-reset.js';
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
  private readonly current: Date;
  constructor(start: Date) {
    this.current = start;
  }
  now(): Date {
    return this.current;
  }
}

const uniqueEmail = (): string => `pwreset-test-${Math.random().toString(36).slice(2)}@example.com`;

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

interface TestHarness {
  readonly app: App;
  readonly db: Kysely<Database>;
  readonly logLines: () => readonly Record<string, unknown>[];
}

/** Registers both auth slices sharing one DB/clock, capturing log output for the R14 token event. */
const buildTestApp = async (clock: Clock = new FakeClock(new Date())): Promise<TestHarness> => {
  const db = createDb(databaseUrl);
  const { destination, logLines } = createLogCapture();
  const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'info' }, destination) });
  registerAuthRoutes(app, { db, clock, config: testConfig });
  registerPasswordResetRoutes(app, { db, clock });
  return { app, db, logLines };
};

const withOrigin = (headers: Record<string, string> = {}): Record<string, string> => ({
  origin: testConfig.appOrigin,
  ...headers,
});

const registerUser = async (app: App, email: string, password: string): Promise<void> => {
  await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: withOrigin(),
    payload: { email, password },
  });
};

const requestReset = async (app: App, email: string): Promise<ReturnType<App['inject']>> =>
  app.inject({
    method: 'POST',
    url: '/api/auth/password-reset/request',
    headers: withOrigin(),
    payload: { email },
  });

const tokenFromLogs = (logLines: () => readonly Record<string, unknown>[]): string => {
  const event = findLogEvent(logLines(), 'auth.password_reset_token');
  expect(typeof event['resetToken']).toBe('string');
  return event['resetToken'] as string;
};

afterAll(async () => {
  await migratorDb
    .deleteFrom('password_reset_tokens')
    .where('user_id', 'in', (qb) =>
      qb.selectFrom('users').select('id').where('email', 'like', 'pwreset-test-%'),
    )
    .execute();
  await migratorDb
    .deleteFrom('audit_events')
    .where('event_type', 'like', 'auth.%')
    .where('user_id', 'in', (qb) =>
      qb.selectFrom('users').select('id').where('email', 'like', 'pwreset-test-%'),
    )
    .execute();
  await migratorDb
    .deleteFrom('sessions')
    .where('user_id', 'in', (qb) =>
      qb.selectFrom('users').select('id').where('email', 'like', 'pwreset-test-%'),
    )
    .execute();
  await migratorDb.deleteFrom('users').where('email', 'like', 'pwreset-test-%').execute();
  await migratorDb.destroy();
});

describe('POST /api/auth/password-reset/request', () => {
  it('returns 202, stores a sha-256 hash, and delivers the raw token only via the log event (R14)', async () => {
    const { app, db, logLines } = await buildTestApp();
    const email = uniqueEmail();
    await registerUser(app, email, 'original-password');

    const response = await requestReset(app, email);
    expect(response.statusCode).toBe(202);

    const rawToken = tokenFromLogs(logLines);
    // Never in the API response (R14).
    expect(response.body).not.toContain(rawToken);

    const row = await db
      .selectFrom('password_reset_tokens')
      .selectAll()
      .where('token_hash', '=', sha256Hex(rawToken))
      .executeTakeFirst();
    expect(row).toBeDefined();
    expect(row?.used_at).toBeNull();
    // Raw token is never stored — only its hash.
    expect(row?.token_hash).not.toBe(rawToken);

    const audit = await db
      .selectFrom('audit_events')
      .selectAll()
      .where('event_type', '=', 'auth.password_reset')
      .where('user_id', '=', row?.user_id ?? '')
      .executeTakeFirst();
    expect(audit).toBeDefined();
  });

  it('responds 202 with an identical body for an unknown email (no enumeration)', async () => {
    const { app, logLines } = await buildTestApp();
    const email = uniqueEmail();
    await registerUser(app, email, 'original-password');

    const known = await requestReset(app, email);
    const unknown = await requestReset(app, uniqueEmail());

    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(unknown.body).toBe(known.body);

    // Only the real account produced a token.
    const events = logLines().filter((line) => line['event'] === 'auth.password_reset_token');
    expect(events).toHaveLength(1);
  });
});

describe('POST /api/auth/password-reset/confirm', () => {
  it('sets the new password, consumes the token, and revokes existing sessions', async () => {
    const { app, logLines } = await buildTestApp();
    const email = uniqueEmail();
    await registerUser(app, email, 'original-password');
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: withOrigin(),
      payload: { email, password: 'original-password' },
    });
    const cookie = firstCookie(login);

    await requestReset(app, email);
    const rawToken = tokenFromLogs(logLines);

    const confirm = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/confirm',
      headers: withOrigin(),
      payload: { token: rawToken, newPassword: 'brand-new-password' },
    });
    expect(confirm.statusCode).toBe(204);

    // Existing sessions are revoked by a successful reset.
    const meAfterReset = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [cookie.name]: cookie.value },
    });
    expect(meAfterReset.statusCode).toBe(401);

    const oldPasswordLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: withOrigin(),
      payload: { email, password: 'original-password' },
    });
    expect(oldPasswordLogin.statusCode).toBe(401);

    const newPasswordLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: withOrigin(),
      payload: { email, password: 'brand-new-password' },
    });
    expect(newPasswordLogin.statusCode).toBe(200);
  });

  it('rejects a reused token with 400 (single-use)', async () => {
    const { app, logLines } = await buildTestApp();
    const email = uniqueEmail();
    await registerUser(app, email, 'original-password');
    await requestReset(app, email);
    const rawToken = tokenFromLogs(logLines);

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/confirm',
      headers: withOrigin(),
      payload: { token: rawToken, newPassword: 'brand-new-password' },
    });
    expect(first.statusCode).toBe(204);

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/confirm',
      headers: withOrigin(),
      payload: { token: rawToken, newPassword: 'another-password' },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json()).toEqual({ error: { code: 'validation_failed', message: expect.any(String) } });
  });

  it('rejects an unknown token with 400', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/confirm',
      headers: withOrigin(),
      payload: { token: 'not-a-real-token', newPassword: 'brand-new-password' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an expired token with 400 (1 hour TTL)', async () => {
    const start = new Date();
    const { app, db, logLines } = await buildTestApp(new FakeClock(start));
    const email = uniqueEmail();
    await registerUser(app, email, 'original-password');
    await requestReset(app, email);
    const rawToken = tokenFromLogs(logLines);

    // A second app instance sharing the same DB, clocked 61 minutes later — past the 1 h TTL.
    const laterApp = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
    registerPasswordResetRoutes(laterApp, { db, clock: new FakeClock(new Date(start.getTime() + 61 * 60 * 1000)) });

    const response = await laterApp.inject({
      method: 'POST',
      url: '/api/auth/password-reset/confirm',
      headers: withOrigin(),
      payload: { token: rawToken, newPassword: 'brand-new-password' },
    });
    expect(response.statusCode).toBe(400);
  });
});
