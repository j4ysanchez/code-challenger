import { PgBoss } from 'pg-boss';
import { EVALUATION_DEAD_LETTER_QUEUE_NAME, EVALUATION_QUEUE_NAME, type EvaluationJobPayload } from '@code-challenger/contracts';

/** research.md R6: start with 2 concurrent evaluations per worker (bounded concurrency, Principle IV). */
export const WORKER_CONCURRENCY = 2;
/** Per-job retry limit before a job is copied to the dead-letter queue. */
export const RETRY_LIMIT = 2;

/**
 * Starts pg-boss against the `worker_role` connection and ensures both the
 * evaluation queue and its dead-letter queue exist (idempotent — safe to call
 * from both api and worker at startup).
 *
 * `queueName`/`deadLetterName` default to the real production queues; tests
 * override them with a unique name so they never race a live worker process
 * subscribed to the shared production queue.
 */
export const createEvaluationQueue = async (
  connectionString: string,
  queueName: string = EVALUATION_QUEUE_NAME,
  deadLetterName: string = EVALUATION_DEAD_LETTER_QUEUE_NAME,
): Promise<PgBoss> => {
  // The `pgboss` schema is created by infra/db/migrations/0002_roles_grants.ts (as migrator_role);
  // api_role/worker_role only have CREATE *within* it, not CREATE ON DATABASE, which
  // `CREATE SCHEMA IF NOT EXISTS` requires even when the schema already exists.
  const boss = new PgBoss({ connectionString, schema: 'pgboss', createSchema: false });
  await boss.start();
  await boss.createQueue(deadLetterName);
  await boss.createQueue(queueName, {
    retryLimit: RETRY_LIMIT,
    deadLetter: deadLetterName,
  });
  return boss;
};

/** Subscribes to evaluation jobs with bounded concurrency; a thrown handler error triggers a pg-boss retry. */
export const subscribeEvaluationJobs = async (
  boss: PgBoss,
  handleJob: (payload: EvaluationJobPayload) => Promise<void>,
  queueName: string = EVALUATION_QUEUE_NAME,
): Promise<string> =>
  boss.work<EvaluationJobPayload>(
    queueName,
    { batchSize: 1, localConcurrency: WORKER_CONCURRENCY },
    async (jobs) => {
      for (const job of jobs) {
        await handleJob(job.data);
      }
    },
  );

/** Subscribes to the dead-letter queue — jobs that exhausted every retry (worker crash/system failure). */
export const subscribeDeadLetterJobs = async (
  boss: PgBoss,
  handleDeadLetter: (payload: EvaluationJobPayload) => Promise<void>,
): Promise<string> =>
  boss.work<EvaluationJobPayload>(EVALUATION_DEAD_LETTER_QUEUE_NAME, async (jobs) => {
    for (const job of jobs) {
      await handleDeadLetter(job.data);
    }
  });
