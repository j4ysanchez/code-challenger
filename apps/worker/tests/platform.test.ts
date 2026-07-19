import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { PgBoss } from 'pg-boss';
import { afterAll, describe, expect, it } from 'vitest';
import type { EvaluationJobPayload } from '@code-challenger/contracts';
import { createDb } from '../src/platform/db.js';
import { writeAuditEvent } from '../src/platform/audit.js';
import { RETRY_LIMIT, WORKER_CONCURRENCY, createEvaluationQueue, subscribeEvaluationJobs } from '../src/platform/queue.js';
import { requireEnv } from './test-env.js';

const db = createDb(requireEnv('DATABASE_URL_WORKER'));
// audit_events is append-only for worker_role (no UPDATE/DELETE grant) — cleanup needs the migrator connection.
const migratorDb = createDb(requireEnv('DATABASE_URL_MIGRATOR'));

afterAll(async () => {
  await migratorDb.deleteFrom('audit_events').where('event_type', 'like', 'worker-audit-test.%').execute();
  await db.destroy();
  await migratorDb.destroy();
});

describe('worker_role least privilege', () => {
  it('has no access to the users table (Principle II)', async () => {
    await expect(sql`select 1 from users`.execute(db)).rejects.toThrow(/permission denied/);
  });

  it('has no access to the sessions table', async () => {
    await expect(sql`select 1 from sessions`.execute(db)).rejects.toThrow(/permission denied/);
  });

  it('can read problems and test cases', async () => {
    await expect(sql`select 1 from problems limit 1`.execute(db)).resolves.toBeDefined();
    await expect(sql`select 1 from test_cases limit 1`.execute(db)).resolves.toBeDefined();
  });
});

describe('writeAuditEvent', () => {
  it('inserts a row with event_type, user_id, and jsonb data', async () => {
    await writeAuditEvent(db, {
      eventType: 'worker-audit-test.example',
      userId: null,
      data: { verdict: 'accepted', runtimeMs: 42 },
    });

    const row = await db
      .selectFrom('audit_events')
      .selectAll()
      .where('event_type', '=', 'worker-audit-test.example')
      .executeTakeFirstOrThrow();

    expect(row.data).toEqual({ verdict: 'accepted', runtimeMs: 42 });
  });

  it('refuses to write submitted source code', async () => {
    await expect(
      writeAuditEvent(db, { eventType: 'worker-audit-test.leak', userId: null, data: { sourceCode: 'print(1)' } }),
    ).rejects.toThrow(/forbidden key/);
  });
});

describe('evaluation queue', () => {
  it('delivers an enqueued job to the subscribed handler', async () => {
    // A unique queue name — never the shared production EVALUATION_QUEUE_NAME — so this
    // test can't race a live `dev:worker` process for the job (see sibling dead-letter
    // test below for the same pattern).
    const testQueue = `test-evaluate-${randomUUID()}`;
    const testDeadLetter = `${testQueue}-dlq`;
    const boss = await createEvaluationQueue(requireEnv('DATABASE_URL_WORKER'), testQueue, testDeadLetter);
    try {
      const received: EvaluationJobPayload[] = [];
      await subscribeEvaluationJobs(
        boss,
        async (payload) => {
          received.push(payload);
        },
        testQueue,
      );

      const submissionId = randomUUID();
      await boss.send(testQueue, { submissionId } satisfies EvaluationJobPayload);

      await expect
        .poll(() => received.some((job) => job.submissionId === submissionId), { timeout: 5000, interval: 100 })
        .toBe(true);
    } finally {
      await boss.stop({ graceful: false });
    }
  }, 10_000);

  it('respects the configured retry limit and worker concurrency constants', () => {
    expect(RETRY_LIMIT).toBeGreaterThanOrEqual(1);
    expect(WORKER_CONCURRENCY).toBe(2);
  });

  it('moves a job that exhausts its retries to the dead-letter queue', async () => {
    const testQueue = `test-evaluate-${randomUUID()}`;
    const testDeadLetter = `${testQueue}-dlq`;
    const boss = new PgBoss({ connectionString: requireEnv('DATABASE_URL_WORKER'), schema: 'pgboss', createSchema: false });
    await boss.start();
    try {
      await boss.createQueue(testDeadLetter);
      await boss.createQueue(testQueue, { retryLimit: 1, retryDelay: 0, deadLetter: testDeadLetter });

      await boss.work<EvaluationJobPayload>(testQueue, { pollingIntervalSeconds: 0.5 }, async () => {
        throw new Error('simulated worker crash');
      });

      const deadLettered: EvaluationJobPayload[] = [];
      await boss.work<EvaluationJobPayload>(testDeadLetter, { pollingIntervalSeconds: 0.5 }, async (jobs) => {
        for (const job of jobs) {
          deadLettered.push(job.data);
        }
      });

      const submissionId = randomUUID();
      await boss.send(testQueue, { submissionId } satisfies EvaluationJobPayload, { retryLimit: 1, retryDelay: 0 });

      await expect
        .poll(() => deadLettered.some((job) => job.submissionId === submissionId), { timeout: 10_000, interval: 200 })
        .toBe(true);
    } finally {
      await boss.stop({ graceful: false });
    }
  }, 15_000);
});
