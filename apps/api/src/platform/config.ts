import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL_API: z.string().url(),
  SESSION_COOKIE_SECRET: z.string().min(32),
  API_PORT: z.coerce.number().int().positive().default(3000),
  APP_ORIGIN: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export interface Config {
  readonly databaseUrl: string;
  readonly sessionCookieSecret: string;
  readonly port: number;
  /** The SPA's origin; state-changing requests must present a matching `Origin` header (CSRF defense). */
  readonly appOrigin: string;
  readonly nodeEnv: 'development' | 'test' | 'production';
}

/** Validates the process environment at startup; throws on a missing/malformed variable (fail fast). */
export const loadConfig = (env: Record<string, string | undefined> = process.env): Config => {
  const parsed = envSchema.parse(env);
  return {
    databaseUrl: parsed.DATABASE_URL_API,
    sessionCookieSecret: parsed.SESSION_COOKIE_SECRET,
    port: parsed.API_PORT,
    appOrigin: parsed.APP_ORIGIN,
    nodeEnv: parsed.NODE_ENV,
  };
};
