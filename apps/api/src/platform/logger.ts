import type { Writable } from 'node:stream';
import pino, { type Logger } from 'pino';

/**
 * Fields that must never reach general application logs: credentials and
 * submitted source code (constitution Principle V / R12). Matches both
 * top-level keys and one level of nesting (`req.body.password`, etc.).
 */
const REDACT_PATHS = [
  'password',
  '*.password',
  'password_hash',
  '*.password_hash',
  'source',
  '*.source',
  'sourceCode',
  '*.sourceCode',
  'source_code',
  '*.source_code',
  'sessionCookieSecret',
  '*.sessionCookieSecret',
  'req.headers.cookie',
  'req.headers.authorization',
];

export const createLogger = (
  config: { readonly level?: string },
  destination?: Writable,
): Logger =>
  pino(
    {
      level: config.level ?? 'info',
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    },
    destination,
  );
