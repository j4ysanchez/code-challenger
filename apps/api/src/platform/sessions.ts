import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { err, ok, type Result } from '../kernel/result.js';
import type { Clock } from './clock.js';
import type { Database } from './db.js';
import { errorEnvelope } from './errors.js';

export const SESSION_COOKIE_NAME = 'sid';

/** Rolling 30-day max session lifetime (data-model.md sessions.expires_at). */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly role: 'member' | 'admin';
}

export interface CreatedSession {
  readonly id: string;
  readonly expiresAt: Date;
}

export const createSession = async (
  db: Kysely<Database>,
  userId: string,
  clock: Clock,
): Promise<CreatedSession> => {
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const row = await db
    .insertInto('sessions')
    .values({ user_id: userId, created_at: now, expires_at: expiresAt })
    .returning(['id', 'expires_at'])
    .executeTakeFirstOrThrow();
  return { id: row.id, expiresAt: row.expires_at };
};

export const setSessionCookie = (
  reply: FastifyReply,
  sessionId: string,
  config: { readonly nodeEnv: string },
): void => {
  reply.setCookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
    signed: true,
    maxAge: SESSION_TTL_MS / 1000,
  });
};

export const clearSessionCookie = (reply: FastifyReply): void => {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
};

type SessionLookupError = 'invalid' | 'expired';

export const lookupSession = async (
  db: Kysely<Database>,
  sessionId: string,
  clock: Clock,
): Promise<Result<{ user: SessionUser }, SessionLookupError>> => {
  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select([
      'sessions.expires_at as expires_at',
      'users.id as user_id',
      'users.email as email',
      'users.role as role',
    ])
    .where('sessions.id', '=', sessionId)
    .executeTakeFirst();

  if (!row) {
    return err('invalid');
  }
  if (row.expires_at.getTime() <= clock.now().getTime()) {
    return err('expired');
  }

  const newExpiresAt = new Date(clock.now().getTime() + SESSION_TTL_MS);
  await db.updateTable('sessions').set({ expires_at: newExpiresAt }).where('id', '=', sessionId).execute();

  return ok({ user: { id: row.user_id, email: row.email, role: row.role } });
};

/** Reads the value `requireMember`/`requireAdmin` stashed on the request. */
export const getSessionUser = (request: FastifyRequest): SessionUser | undefined =>
  (request as FastifyRequest & { user?: SessionUser }).user;

const sessionIdFromRequest = (request: FastifyRequest): string | undefined => {
  const raw = request.cookies[SESSION_COOKIE_NAME];
  if (!raw) {
    return undefined;
  }
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : undefined;
};

/** Deny-by-default: any session-lookup failure is 401 unauthorized. */
export const requireMember =
  (db: Kysely<Database>, clock: Clock) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const sessionId = sessionIdFromRequest(request);
    const result = sessionId ? await lookupSession(db, sessionId, clock) : err<SessionLookupError>('invalid');

    if (!result.ok) {
      await reply.code(401).send(errorEnvelope('unauthorized', 'authentication required'));
      return;
    }

    (request as FastifyRequest & { user: SessionUser }).user = result.value.user;
  };

/** Server-side revocation for logout: deletes the session row the request's cookie points to, if any. */
export const revokeSession = async (db: Kysely<Database>, request: FastifyRequest): Promise<void> => {
  const sessionId = sessionIdFromRequest(request);
  if (sessionId) {
    await db.deleteFrom('sessions').where('id', '=', sessionId).execute();
  }
};

/** Attaches the session user if present and valid; never denies — for public routes with an authenticated variant. */
export const optionalSession =
  (db: Kysely<Database>, clock: Clock) =>
  async (request: FastifyRequest): Promise<void> => {
    const sessionId = sessionIdFromRequest(request);
    if (!sessionId) {
      return;
    }
    const result = await lookupSession(db, sessionId, clock);
    if (result.ok) {
      (request as FastifyRequest & { user: SessionUser }).user = result.value.user;
    }
  };

/** requireMember first (401 for anonymous), then an admin-role check (403 for authenticated non-admins). */
export const requireAdmin =
  (db: Kysely<Database>, clock: Clock) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireMember(db, clock)(request, reply);
    if (reply.sent) {
      return;
    }

    const user = (request as FastifyRequest & { user?: SessionUser }).user;
    if (!user || user.role !== 'admin') {
      await reply.code(403).send(errorEnvelope('forbidden', 'admin role required'));
    }
  };
