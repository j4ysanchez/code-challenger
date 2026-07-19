import type { ZodType } from 'zod';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export interface ApiRequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

interface ErrorEnvelopeLike {
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

/** Typed fetch wrapper: every response is parsed against the caller's contract schema. */
export const apiFetch = async <T>(
  path: string,
  schema: ZodType<T>,
  options: ApiRequestOptions = {},
): Promise<T> => {
  const hasBody = options.body !== undefined;
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    ...(options.signal ? { signal: options.signal } : {}),
    ...(hasBody
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) }
      : {}),
  });

  if (response.status === 204) {
    return schema.parse(undefined);
  }

  const json: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const envelope = json as ErrorEnvelopeLike;
    const code = typeof envelope?.error?.code === 'string' ? envelope.error.code : 'internal';
    const message =
      typeof envelope?.error?.message === 'string' ? envelope.error.message : 'request failed';
    throw new ApiError(code, message, response.status);
  }

  return schema.parse(json);
};
