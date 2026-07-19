import { PgBoss } from 'pg-boss';
import { EVALUATION_DEAD_LETTER_QUEUE_NAME, EVALUATION_QUEUE_NAME, type EvaluationJobPayload } from '@code-challenger/contracts';

/** Mirrors apps/worker/src/platform/queue.ts's queue/retry/dead-letter configuration (single source of truth in practice). */
const RETRY_LIMIT = 2;

/**
 * Starts pg-boss against the `api_role` connection and ensures the evaluation
 * queue (and its dead-letter queue) exist — idempotent, safe alongside the
 * worker doing the same at its own startup.
 */
export const createEnqueueClient = async (connectionString: string): Promise<PgBoss> => {
  // The `pgboss` schema is created by infra/db/migrations/0002_roles_grants.ts (as migrator_role);
  // api_role only has CREATE *within* it, not CREATE ON DATABASE, which `CREATE SCHEMA IF NOT EXISTS`
  // requires even when the schema already exists.
  const boss = new PgBoss({ connectionString, schema: 'pgboss', createSchema: false });
  await boss.start();
  await boss.createQueue(EVALUATION_DEAD_LETTER_QUEUE_NAME);
  await boss.createQueue(EVALUATION_QUEUE_NAME, { retryLimit: RETRY_LIMIT, deadLetter: EVALUATION_DEAD_LETTER_QUEUE_NAME });
  return boss;
};

export const enqueueEvaluationJob = async (boss: PgBoss, payload: EvaluationJobPayload): Promise<void> => {
  await boss.send(EVALUATION_QUEUE_NAME, payload);
};
