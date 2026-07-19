import { closeSync, mkdtempSync, openSync, readFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

/** Reads a required env var for integration tests; throws with a clear message if unset. */
export const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var for test: ${name}`);
  }
  return value;
};

export interface LogCapture {
  /** A Writable to pass as the logger's destination. */
  readonly destination: Writable;
  /** Every captured log line, parsed as JSON, in write order. */
  readonly logLines: () => readonly Record<string, unknown>[];
}

/**
 * A synchronous file-backed pino destination for tests that need to observe a
 * structured-log event (e.g. the R14 password-reset token delivery) without
 * buffering log output in a mutable in-memory collection.
 */
export const createLogCapture = (): LogCapture => {
  const dir = mkdtempSync(join(tmpdir(), 'api-test-log-'));
  const path = join(dir, 'log.ndjson');
  const fd = openSync(path, 'a');
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      writeSync(fd, chunk);
      callback();
    },
    final(callback): void {
      closeSync(fd);
      callback();
    },
  });
  const logLines = (): readonly Record<string, unknown>[] =>
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { destination, logLines };
};

/** Finds a structured-log event by its `event` field; fails the test with a clear message if absent. */
export const findLogEvent = (
  lines: readonly Record<string, unknown>[],
  eventName: string,
): Record<string, unknown> => {
  const event = lines.find((line) => line['event'] === eventName);
  if (!event) {
    throw new Error(`expected a log event named "${eventName}", found none among ${lines.length} line(s)`);
  }
  return event;
};

interface InjectedCookie {
  readonly name: string;
  readonly value: string;
}

/** Grabs the first Set-Cookie from a fastify.inject response; throws if the test's assumption is wrong. */
export const firstCookie = (response: { readonly cookies: readonly InjectedCookie[] }): InjectedCookie => {
  const [cookie] = response.cookies;
  if (!cookie) {
    throw new Error('expected the response to set at least one cookie');
  }
  return cookie;
};
