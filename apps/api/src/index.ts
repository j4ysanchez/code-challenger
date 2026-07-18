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

const config = loadConfig();
const logger = createLogger({ level: config.nodeEnv === 'production' ? 'info' : 'debug' });
const db = createDb(config.databaseUrl);

const app = await buildApp({ config, logger });
registerAuthRoutes(app, { db, clock: systemClock, config });

await app.listen({ port: config.port, host: '0.0.0.0' });
