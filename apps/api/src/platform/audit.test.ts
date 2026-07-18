import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from './db.js';
import { writeAuditEvent } from './audit.js';
import { requireEnv } from './test-env.js';

const db = createDb(requireEnv('DATABASE_URL_API'));
// audit_events is append-only for api_role (no UPDATE/DELETE grant, by design) — cleanup
// needs the migrator connection, which owns the table.
const migratorDb = createDb(requireEnv('DATABASE_URL_MIGRATOR'));

afterAll(async () => {
  await migratorDb.deleteFrom('audit_events').where('event_type', 'like', 'audit-test.%').execute();
  await db.destroy();
  await migratorDb.destroy();
});

describe('writeAuditEvent', () => {
  it('inserts a row with event_type, user_id, and jsonb data', async () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    await writeAuditEvent(db, {
      eventType: 'audit-test.example',
      userId,
      data: { ip: '127.0.0.1', verdict: 'accepted' },
    });

    const row = await db
      .selectFrom('audit_events')
      .selectAll()
      .where('event_type', '=', 'audit-test.example')
      .executeTakeFirstOrThrow();

    expect(row.user_id).toBe(userId);
    expect(row.data).toEqual({ ip: '127.0.0.1', verdict: 'accepted' });
  });

  it('allows a null user_id for anonymous events', async () => {
    await writeAuditEvent(db, {
      eventType: 'audit-test.anonymous',
      userId: null,
      data: {},
    });

    const row = await db
      .selectFrom('audit_events')
      .selectAll()
      .where('event_type', '=', 'audit-test.anonymous')
      .executeTakeFirstOrThrow();

    expect(row.user_id).toBeNull();
  });

  it('refuses to write a password field, even if a caller tries', async () => {
    await expect(
      writeAuditEvent(db, {
        eventType: 'audit-test.leak',
        userId: null,
        data: { password: 'hunter2' },
      }),
    ).rejects.toThrow(/forbidden key/);
  });

  it('refuses to write submitted source code', async () => {
    await expect(
      writeAuditEvent(db, {
        eventType: 'audit-test.leak',
        userId: null,
        data: { sourceCode: 'print(1)' },
      }),
    ).rejects.toThrow(/forbidden key/);
  });
});
