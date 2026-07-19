try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // no local .env (e.g. CI/production inject env directly) — ignore
}

import { loadConfig } from './platform/config.js';
import { createDb } from './platform/db.js';
import { createEvaluationQueue, subscribeDeadLetterJobs, subscribeEvaluationJobs } from './platform/queue.js';
import { evaluateSubmission, markSubmissionAsSystemError } from './features/evaluate/evaluate.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);
const boss = await createEvaluationQueue(config.databaseUrl);

await subscribeEvaluationJobs(boss, (payload) => evaluateSubmission(db, payload));
await subscribeDeadLetterJobs(boss, (payload) => markSubmissionAsSystemError(db, payload));

console.log('worker: subscribed to evaluation and dead-letter queues');
