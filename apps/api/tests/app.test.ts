import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp, zodBodyValidator, type App } from '../src/app.js';
import type { Config } from '../src/platform/config.js';
import { createLogger } from '../src/platform/logger.js';

const testConfig: Config = {
  databaseUrl: 'postgres://api_role:pw@localhost:5432/code_challenger',
  sessionCookieSecret: 'a'.repeat(32),
  port: 3000,
  appOrigin: 'http://localhost:5173',
  nodeEnv: 'test',
};

const buildTestApp = async (): Promise<App> => {
  const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });

  app.get('/__test/boom', async () => {
    throw new Error('sensitive internal detail: db password is hunter2');
  });

  const bodySchema = z.object({ name: z.string().min(1) });
  app.post(
    '/__test/echo',
    { preHandler: zodBodyValidator(bodySchema) },
    async (request) => ({ received: (request as typeof request & { validatedBody: unknown }).validatedBody }),
  );

  return app;
};

describe('security headers', () => {
  it('sets CSP, X-Content-Type-Options, and frame-ancestors on every response', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});

describe('error handling', () => {
  it('maps unhandled errors to the contract error envelope without leaking internals', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/__test/boom' });
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body).toEqual({ error: { code: 'internal', message: expect.any(String) } });
    expect(body.error.message).not.toContain('hunter2');
    expect(body.error.message).not.toContain('sensitive internal detail');
  });

  it('maps unknown routes to a 404 not_found envelope', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
  });
});

describe('origin check on state-changing routes', () => {
  it('rejects a POST with a mismatched Origin header', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: { name: 'a' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: 'forbidden', message: expect.any(String) } });
  });

  it('rejects a POST with no Origin header at all', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'a' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('accepts a POST whose Origin header matches the configured app origin', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { origin: testConfig.appOrigin, 'content-type': 'application/json' },
      payload: { name: 'a' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('does not require an Origin header on GET requests', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(response.statusCode).not.toBe(403);
  });
});

describe('zodBodyValidator', () => {
  it('returns 422 validation_failed when the body fails schema validation', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { origin: testConfig.appOrigin, 'content-type': 'application/json' },
      payload: { name: '' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: { code: 'validation_failed', message: expect.any(String) },
    });
  });

  it('passes the parsed body through to the handler on success', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { origin: testConfig.appOrigin, 'content-type': 'application/json' },
      payload: { name: 'Ada' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: { name: 'Ada' } });
  });
});

describe('rate limiting', () => {
  it('returns 429 rate_limited once the per-IP baseline is exceeded', async () => {
    const app = await buildApp({
      config: testConfig,
      logger: createLogger({ level: 'silent' }),
      rateLimit: { max: 2, timeWindow: '1 minute' },
    });
    app.get('/__test/ping', async () => ({ ok: true }));

    const hitOnce = () => app.inject({ method: 'GET', url: '/__test/ping' });
    await hitOnce();
    await hitOnce();
    const third = await hitOnce();
    expect(third.statusCode).toBe(429);
    expect(third.json()).toEqual({ error: { code: 'rate_limited', message: expect.any(String) } });
    expect(third.headers['retry-after']).toBeDefined();
  });
});
