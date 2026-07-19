import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { Kysely } from 'kysely';
import {
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from '@code-challenger/contracts';
import { getValidatedBody, zodBodyValidator, type App } from '../../app.js';
import type { Clock } from '../../platform/clock.js';
import type { Database } from '../../platform/db.js';
import { writeAuditEvent } from '../../platform/audit.js';
import { errorEnvelope } from '../../platform/errors.js';

export interface PasswordResetDeps {
  readonly db: Kysely<Database>;
  readonly clock: Clock;
}

/** Tighter than the global per-IP baseline — same rationale as auth.ts's AUTH_RATE_LIMIT. */
const AUTH_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

export const registerPasswordResetRoutes = (app: App, deps: PasswordResetDeps): void => {
  app.post(
    '/api/auth/password-reset/request',
    { preHandler: zodBodyValidator(passwordResetRequestSchema), config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      const body = getValidatedBody<{ email: string }>(request);

      const user = await deps.db
        .selectFrom('users')
        .select('id')
        .where('email', '=', body.email)
        .executeTakeFirst();

      // No account enumeration (contracts/api.md): always 202, regardless of match.
      if (user) {
        const rawToken = randomBytes(32).toString('hex');
        const now = deps.clock.now();
        await deps.db
          .insertInto('password_reset_tokens')
          .values({
            token_hash: sha256Hex(rawToken),
            user_id: user.id,
            expires_at: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
            used_at: null,
          })
          .execute();

        // R14: the raw token is delivered only via this structured-log event — never in the API response.
        request.log.info({ event: 'auth.password_reset_token', userId: user.id, resetToken: rawToken });
        await writeAuditEvent(deps.db, { eventType: 'auth.password_reset', userId: user.id, data: {} });
      }

      await reply.code(202).send();
    },
  );

  app.post(
    '/api/auth/password-reset/confirm',
    { preHandler: zodBodyValidator(passwordResetConfirmSchema), config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      const body = getValidatedBody<{ token: string; newPassword: string }>(request);
      const tokenHash = sha256Hex(body.token);

      const tokenRow = await deps.db
        .selectFrom('password_reset_tokens')
        .selectAll()
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst();

      const now = deps.clock.now();
      const isValid = tokenRow && tokenRow.used_at === null && tokenRow.expires_at.getTime() > now.getTime();
      if (!isValid) {
        await reply.code(400).send(errorEnvelope('validation_failed', 'reset token is invalid, expired, or used'));
        return;
      }

      const passwordHash = await argon2.hash(body.newPassword, { type: argon2.argon2id });
      await deps.db
        .updateTable('users')
        .set({ password_hash: passwordHash })
        .where('id', '=', tokenRow.user_id)
        .execute();
      await deps.db
        .updateTable('password_reset_tokens')
        .set({ used_at: now })
        .where('token_hash', '=', tokenHash)
        .execute();
      // A password reset invalidates every existing session for the account.
      await deps.db.deleteFrom('sessions').where('user_id', '=', tokenRow.user_id).execute();

      await reply.code(204).send();
    },
  );
};
