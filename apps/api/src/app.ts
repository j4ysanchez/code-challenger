import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit, { type RateLimitPluginOptions } from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import type { Logger } from 'pino';
import type { ZodType } from 'zod';
import { errorEnvelope } from './platform/errors.js';
import type { Config } from './platform/config.js';

export interface AppDeps {
  readonly config: Config;
  readonly logger: Logger;
  /** Overridable for tests that need a low threshold to exercise 429 behavior. */
  readonly rateLimit?: RateLimitPluginOptions;
}

interface HandledError extends Error {
  statusCode?: number;
  validation?: unknown;
}

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Validates `request.body` against a Zod schema; stashes the parsed value for the handler. */
export const zodBodyValidator =
  <T>(schema: ZodType<T>) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      await reply
        .code(422)
        .send(errorEnvelope('validation_failed', parsed.error.issues.map((i) => i.message).join('; ')));
      return;
    }
    (request as FastifyRequest & { validatedBody: T }).validatedBody = parsed.data;
  };

/** Reads the value `zodBodyValidator` stashed on the request. */
export const getValidatedBody = <T>(request: FastifyRequest): T =>
  (request as FastifyRequest & { validatedBody: T }).validatedBody;

/** Validates `request.query` against a Zod schema; stashes the parsed value for the handler. */
export const zodQueryValidator =
  <T>(schema: ZodType<T>) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      await reply
        .code(422)
        .send(errorEnvelope('validation_failed', parsed.error.issues.map((i) => i.message).join('; ')));
      return;
    }
    (request as FastifyRequest & { validatedQuery: T }).validatedQuery = parsed.data;
  };

/** Reads the value `zodQueryValidator` stashed on the request. */
export const getValidatedQuery = <T>(request: FastifyRequest): T =>
  (request as FastifyRequest & { validatedQuery: T }).validatedQuery;

export const buildApp = async (deps: AppDeps) => {
  const app = Fastify({ loggerInstance: deps.logger });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    ...deps.rateLimit,
  });

  await app.register(cookie, { secret: deps.config.sessionCookieSecret });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'");
    reply.header('X-Frame-Options', 'DENY');
    return payload;
  });

  // CSRF defense: state-changing requests must present an Origin header matching the SPA (research.md R9).
  app.addHook('onRequest', async (request, reply) => {
    if (!STATE_CHANGING_METHODS.has(request.method)) {
      return;
    }
    if (request.headers.origin !== deps.config.appOrigin) {
      await reply.code(403).send(errorEnvelope('forbidden', 'origin not allowed'));
    }
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send(errorEnvelope('not_found', 'not found'));
  });

  app.setErrorHandler<HandledError>((error, request, reply) => {
    if (reply.statusCode === 429 || error.statusCode === 429) {
      reply.code(429).send(errorEnvelope('rate_limited', 'too many requests'));
      return;
    }
    if (error.validation) {
      reply.code(422).send(errorEnvelope('validation_failed', error.message));
      return;
    }
    request.log.error({ err: error }, 'unhandled error');
    reply.code(500).send(errorEnvelope('internal', 'internal server error'));
  });

  return app;
};

export type App = Awaited<ReturnType<typeof buildApp>>;
