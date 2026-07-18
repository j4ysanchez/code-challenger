import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/platform/config.js';
import { createLogger } from '../src/platform/logger.js';
import { systemClock } from '../src/platform/clock.js';

const validEnv = {
  DATABASE_URL_API: 'postgres://api_role:pw@localhost:5432/code_challenger',
  SESSION_COOKIE_SECRET: 'a'.repeat(32),
  API_PORT: '3000',
  APP_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
};

describe('loadConfig', () => {
  it('parses a valid environment into a typed config', () => {
    const config = loadConfig(validEnv);
    expect(config).toEqual({
      databaseUrl: validEnv.DATABASE_URL_API,
      sessionCookieSecret: validEnv.SESSION_COOKIE_SECRET,
      port: 3000,
      appOrigin: validEnv.APP_ORIGIN,
      nodeEnv: 'test',
    });
  });

  it('throws when a required variable is missing', () => {
    const envWithoutDatabaseUrl: Record<string, string | undefined> = { ...validEnv };
    envWithoutDatabaseUrl['DATABASE_URL_API'] = undefined;
    expect(() => loadConfig(envWithoutDatabaseUrl)).toThrow();
  });

  it('throws when the session cookie secret is too short to be a real secret', () => {
    expect(() => loadConfig({ ...validEnv, SESSION_COOKIE_SECRET: 'short' })).toThrow();
  });

  it('defaults NODE_ENV to development when unset', () => {
    const envWithoutNodeEnv: Record<string, string | undefined> = { ...validEnv };
    envWithoutNodeEnv['NODE_ENV'] = undefined;
    expect(loadConfig(envWithoutNodeEnv).nodeEnv).toBe('development');
  });
});

const captureLogLines = (): { stream: Writable; lines: () => unknown[] } => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: () => chunks.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line)),
  };
};

describe('createLogger redaction', () => {
  it('redacts password fields', () => {
    const { stream, lines } = captureLogLines();
    const logger = createLogger({ level: 'info' }, stream);
    logger.info({ password: 'hunter2', email: 'user@example.com' }, 'login attempt');
    const [entry] = lines();
    expect((entry as Record<string, unknown>)['password']).toBe('[redacted]');
    expect((entry as Record<string, unknown>)['email']).toBe('user@example.com');
  });

  it('redacts submitted source code fields', () => {
    const { stream, lines } = captureLogLines();
    const logger = createLogger({ level: 'info' }, stream);
    logger.info({ sourceCode: 'print("secret")' }, 'submission received');
    const [entry] = lines();
    expect((entry as Record<string, unknown>)['sourceCode']).toBe('[redacted]');
  });

  it('redacts the session cookie secret', () => {
    const { stream, lines } = captureLogLines();
    const logger = createLogger({ level: 'info' }, stream);
    logger.info({ sessionCookieSecret: 'super-secret-value' }, 'boot');
    const [entry] = lines();
    expect((entry as Record<string, unknown>)['sessionCookieSecret']).toBe('[redacted]');
  });
});

describe('systemClock', () => {
  it('returns the current time', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});
