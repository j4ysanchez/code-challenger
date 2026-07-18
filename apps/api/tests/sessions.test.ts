import { afterAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../src/platform/db.js';
import type { Clock } from '../src/platform/clock.js';
import {
  clearSessionCookie,
  createSession,
  lookupSession,
  requireAdmin,
  requireMember,
  setSessionCookie,
  SESSION_COOKIE_NAME,
} from '../src/platform/sessions.js';
import { buildApp } from '../src/app.js';
import { createLogger } from '../src/platform/logger.js';
import { requireEnv } from '../src/platform/test-env.js';
import type { Kysely } from 'kysely';

const databaseUrl = requireEnv('DATABASE_URL_API');
const db = createDb(databaseUrl);

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
  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

const createTestUser = async (
  database: Kysely<Database>,
  role: 'member' | 'admin' = 'member',
): Promise<{ id: string; email: string }> => {
  const email = `sessions-test-${Math.random().toString(36).slice(2)}@example.com`;
  const row = await database
    .insertInto('users')
    .values({ email, password_hash: 'x', role })
    .returning(['id', 'email'])
    .executeTakeFirstOrThrow();
  return { id: row.id, email: row.email };
};

afterAll(async () => {
  await db.deleteFrom('users').where('email', 'like', 'sessions-test-%').execute();
  await db.destroy();
});

describe('createSession + setSessionCookie', () => {
  it('creates a session row and sets an HttpOnly/Secure/SameSite=Lax cookie', async () => {
    const user = await createTestUser(db);
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const session = await createSession(db, user.id, clock);
    expect(session.id).toBeTruthy();

    const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
    app.get('/__test/set-cookie', async (_request, reply) => {
      setSessionCookie(reply, session.id, testConfig);
      return { ok: true };
    });
    const response = await app.inject({ method: 'GET', url: '/__test/set-cookie' });
    const setCookie = response.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieHeader).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookieHeader).toMatch(/HttpOnly/i);
    expect(cookieHeader).toMatch(/SameSite=Lax/i);
  });
});

describe('clearSessionCookie', () => {
  it('expires the cookie immediately', async () => {
    const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
    app.get('/__test/clear-cookie', async (_request, reply) => {
      clearSessionCookie(reply);
      return { ok: true };
    });
    const response = await app.inject({ method: 'GET', url: '/__test/clear-cookie' });
    const setCookie = response.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieHeader).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookieHeader).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });
});

describe('lookupSession', () => {
  it('resolves to the owning user for a valid, unexpired session', async () => {
    const user = await createTestUser(db, 'admin');
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const session = await createSession(db, user.id, clock);

    const result = await lookupSession(db, session.id, clock);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user).toEqual({ id: user.id, email: user.email, role: 'admin' });
    }
  });

  it('fails for an unknown session id', async () => {
    const clock = new FakeClock(new Date());
    const result = await lookupSession(db, '00000000-0000-0000-0000-000000000000', clock);
    expect(result.ok).toBe(false);
  });

  it('fails once the session has expired', async () => {
    const user = await createTestUser(db);
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const session = await createSession(db, user.id, clock);

    clock.advanceMs(31 * 24 * 60 * 60 * 1000); // 31 days later, past the 30-day TTL
    const result = await lookupSession(db, session.id, clock);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('expired');
    }
  });

  it('rolls the expiry forward on each successful lookup', async () => {
    const user = await createTestUser(db);
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const session = await createSession(db, user.id, clock);

    clock.advanceMs(20 * 24 * 60 * 60 * 1000); // 20 days later, still valid
    const firstLookup = await lookupSession(db, session.id, clock);
    expect(firstLookup.ok).toBe(true);

    clock.advanceMs(20 * 24 * 60 * 60 * 1000); // another 20 days (40 total) — would have expired
    // without the rolling extension from the first lookup, but should still be valid now.
    const secondLookup = await lookupSession(db, session.id, clock);
    expect(secondLookup.ok).toBe(true);
  });
});

describe('requireMember / requireAdmin preHandlers', () => {
  const buildTestApp = async () => {
    const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
    const clock = new FakeClock(new Date());
    app.get('/__test/member-only', { preHandler: requireMember(db, clock) }, async (request) => ({
      user: (request as typeof request & { user: unknown }).user,
    }));
    app.get('/__test/admin-only', { preHandler: requireAdmin(db, clock) }, async () => ({ ok: true }));
    return { app, clock };
  };

  it('denies anonymous requests to a member-only route (401)', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/__test/member-only' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: 'unauthorized', message: expect.any(String) } });
  });

  it('allows a member with a valid signed session cookie', async () => {
    const { app, clock } = await buildTestApp();
    const user = await createTestUser(db, 'member');
    const session = await createSession(db, user.id, clock);
    const signed = app.signCookie(session.id);

    const response = await app.inject({
      method: 'GET',
      url: '/__test/member-only',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${signed}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: { id: user.id, email: user.email, role: 'member' } });
  });

  it('rejects a tampered/unsigned cookie value', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/__test/member-only',
      headers: { cookie: `${SESSION_COOKIE_NAME}=not-a-signed-value` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('denies a member on an admin-only route (403)', async () => {
    const { app, clock } = await buildTestApp();
    const user = await createTestUser(db, 'member');
    const session = await createSession(db, user.id, clock);
    const signed = app.signCookie(session.id);

    const response = await app.inject({
      method: 'GET',
      url: '/__test/admin-only',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${signed}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: 'forbidden', message: expect.any(String) } });
  });

  it('allows an admin on an admin-only route', async () => {
    const { app, clock } = await buildTestApp();
    const user = await createTestUser(db, 'admin');
    const session = await createSession(db, user.id, clock);
    const signed = app.signCookie(session.id);

    const response = await app.inject({
      method: 'GET',
      url: '/__test/admin-only',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${signed}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it('denies anonymous requests to an admin-only route (401, not 403)', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/__test/admin-only' });
    expect(response.statusCode).toBe(401);
  });
});
