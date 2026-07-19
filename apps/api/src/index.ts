try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // no local .env (e.g. CI/production inject env directly) — ignore
}

import { buildApp } from './app.js';
import { loadConfig } from './platform/config.js';
import { createLogger } from './platform/logger.js';
import { createDb } from './platform/db.js';
import { systemClock } from './platform/clock.js';
import { registerAuthRoutes } from './features/auth/auth.js';
import { registerPasswordResetRoutes } from './features/auth/password-reset.js';
import { registerProblemsRoutes } from './features/problems/problems.js';
import { registerDraftsRoutes } from './features/drafts/drafts.js';
import { registerCreateSubmissionRoute } from './features/submissions/create.js';
import { registerSubmissionDetailRoute } from './features/submissions/detail.js';
import { registerHistoryRoute } from './features/submissions/history.js';
import { createEnqueueClient, enqueueEvaluationJob } from './platform/queue.js';

const config = loadConfig();
const logger = createLogger({ level: config.nodeEnv === 'production' ? 'info' : 'debug' });
const db = createDb(config.databaseUrl);
const queue = await createEnqueueClient(config.databaseUrl);

const app = await buildApp({ config, logger });
registerAuthRoutes(app, { db, clock: systemClock, config });
registerPasswordResetRoutes(app, { db, clock: systemClock });
registerProblemsRoutes(app, { db, clock: systemClock });
registerDraftsRoutes(app, { db, clock: systemClock });
registerCreateSubmissionRoute(app, { db, clock: systemClock, enqueue: (payload) => enqueueEvaluationJob(queue, payload) });
registerSubmissionDetailRoute(app, { db, clock: systemClock });
registerHistoryRoute(app, { db, clock: systemClock });

await app.listen({ port: config.port, host: '0.0.0.0' });
