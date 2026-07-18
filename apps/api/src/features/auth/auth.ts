import argon2 from 'argon2';
import type { Kysely } from 'kysely';
import { loginRequestSchema, registerRequestSchema } from '@code-challenger/contracts';
import { getValidatedBody, zodBodyValidator, type App } from '../../app.js';
import type { Clock } from '../../platform/clock.js';
import type { Config } from '../../platform/config.js';
import type { Database } from '../../platform/db.js';
import { writeAuditEvent } from '../../platform/audit.js';
import { errorEnvelope } from '../../platform/errors.js';
import {
  createSession,
  clearSessionCookie,
  getSessionUser,
  requireMember,
  revokeSession,
  setSessionCookie,
} from '../../platform/sessions.js';

export interface AuthDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  readonly config: Config;
}

export const registerAuthRoutes = (app: App, deps: AuthDeps): void => {
  app.post(
    '/api/auth/register',
    { preHandler: zodBodyValidator(registerRequestSchema) },
    async (request, reply) => {
      const body = getValidatedBody<{ email: string; password: string }>(request);

      const existing = await deps.db
        .selectFrom('users')
        .select('id')
        .where('email', '=', body.email)
        .executeTakeFirst();
      if (existing) {
        await reply.code(409).send(errorEnvelope('conflict', 'email already registered'));
        return;
      }

      const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
      const user = await deps.db
        .insertInto('users')
        .values({ email: body.email, password_hash: passwordHash })
        .returning(['id', 'email', 'role'])
        .executeTakeFirstOrThrow();

      await writeAuditEvent(deps.db, { eventType: 'auth.register', userId: user.id, data: {} });
      await reply.code(201).send({ user: { id: user.id, email: user.email, role: user.role } });
    },
  );

  app.post('/api/auth/login', { preHandler: zodBodyValidator(loginRequestSchema) }, async (request, reply) => {
    const body = getValidatedBody<{ email: string; password: string }>(request);

    const row = await deps.db.selectFrom('users').selectAll().where('email', '=', body.email).executeTakeFirst();
    const passwordValid = row ? await argon2.verify(row.password_hash, body.password) : false;

    if (!row || !passwordValid) {
      await writeAuditEvent(deps.db, { eventType: 'auth.login_failed', userId: row?.id ?? null, data: {} });
      await reply.code(401).send(errorEnvelope('unauthorized', 'invalid email or password'));
      return;
    }

    const session = await createSession(deps.db, row.id, deps.clock);
    setSessionCookie(reply, session.id, deps.config);
    await writeAuditEvent(deps.db, { eventType: 'auth.login', userId: row.id, data: {} });
    await reply.send({ user: { id: row.id, email: row.email, role: row.role } });
  });

  app.post(
    '/api/auth/logout',
    { preHandler: requireMember(deps.db, deps.clock) },
    async (request, reply) => {
      const user = getSessionUser(request);
      await revokeSession(deps.db, request);
      clearSessionCookie(reply);
      await writeAuditEvent(deps.db, { eventType: 'auth.logout', userId: user?.id ?? null, data: {} });
      await reply.code(204).send();
    },
  );

  app.get('/api/auth/me', { preHandler: requireMember(deps.db, deps.clock) }, async (request, reply) => {
    await reply.send({ user: getSessionUser(request) });
  });
};
