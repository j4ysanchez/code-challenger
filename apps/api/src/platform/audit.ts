import type { Kysely } from 'kysely';
import type { Database } from './db.js';

export interface AuditEvent {
  readonly eventType: string;
  readonly userId: string | null;
  readonly data: Record<string, unknown>;
}

/** Never allowed in audit_events.data — credentials or submitted source code (constitution Principle V). */
const FORBIDDEN_KEYS = new Set([
  'password',
  'password_hash',
  'passwordHash',
  'source',
  'source_code',
  'sourceCode',
  'sessionCookieSecret',
]);

const assertNoForbiddenKeys = (data: Record<string, unknown>): void => {
  for (const key of Object.keys(data)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`audit event data must not include forbidden key: ${key}`);
    }
  }
};

/** Append-only by DB grant (INSERT/SELECT only, no UPDATE/DELETE) — this module never exposes an update path. */
export const writeAuditEvent = async (db: Kysely<Database>, event: AuditEvent): Promise<void> => {
  assertNoForbiddenKeys(event.data);
  await db
    .insertInto('audit_events')
    .values({
      event_type: event.eventType,
      user_id: event.userId,
      data: JSON.stringify(event.data),
    })
    .execute();
};
