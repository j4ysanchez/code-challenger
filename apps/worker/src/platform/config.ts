import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL_WORKER: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export interface Config {
  readonly databaseUrl: string;
  readonly nodeEnv: 'development' | 'test' | 'production';
}

/** Validates the process environment at startup; throws on a missing/malformed variable (fail fast). */
export const loadConfig = (env: Record<string, string | undefined> = process.env): Config => {
  const parsed = envSchema.parse(env);
  return {
    databaseUrl: parsed.DATABASE_URL_WORKER,
    nodeEnv: parsed.NODE_ENV,
  };
};
