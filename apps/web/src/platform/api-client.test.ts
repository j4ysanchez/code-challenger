import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { renderHook, act } from '@testing-library/react';
import { apiFetch, ApiError } from './api-client.js';
import { getSession, setSession, useSession } from './session.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('apiFetch', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('GETs a path under /api, includes credentials, and parses the response with the given schema', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { problems: [] }));
    const schema = z.object({ problems: z.array(z.unknown()) });

    const result = await apiFetch('/problems', schema);

    expect(result).toEqual({ problems: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/problems',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('sends a JSON body with Content-Type on POST', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { user: { id: '1', email: 'a@example.com', role: 'member' } }));
    const schema = z.object({ user: z.object({ id: z.string(), email: z.string(), role: z.string() }) });

    await apiFetch('/auth/register', schema, {
      method: 'POST',
      body: { email: 'a@example.com', password: 'password123' },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(init.body).toBe(JSON.stringify({ email: 'a@example.com', password: 'password123' }));
  });

  it('throws an ApiError carrying the contract error code and status on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: { code: 'conflict', message: 'email already registered' } }));
    const schema = z.object({ user: z.unknown() });

    await expect(apiFetch('/auth/register', schema, { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
      message: 'email already registered',
    });
  });

  it('propagates a schema validation failure when the server response does not match the contract', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { unexpected: true }));
    const schema = z.object({ problems: z.array(z.unknown()) });

    await expect(apiFetch('/problems', schema)).rejects.toThrow();
  });

  it('returns undefined for a 204 No Content response without parsing a body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const result = await apiFetch('/auth/logout', z.void(), { method: 'POST' });
    expect(result).toBeUndefined();
  });
});

describe('ApiError', () => {
  it('is an instance of Error', () => {
    const error = new ApiError('internal', 'boom', 500);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('boom');
  });
});

describe('session store', () => {
  afterEach(() => {
    setSession(null);
  });

  it('starts with no session', () => {
    expect(getSession()).toBeNull();
  });

  it('updates the session and notifies subscribers', () => {
    const user = { id: '1', email: 'a@example.com', role: 'member' as const };
    const { result } = renderHook(() => useSession());

    expect(result.current).toBeNull();

    act(() => {
      setSession(user);
    });

    expect(result.current).toEqual(user);
    expect(getSession()).toEqual(user);
  });

  it('clears the session on logout', () => {
    const user = { id: '1', email: 'a@example.com', role: 'member' as const };
    const { result } = renderHook(() => useSession());

    act(() => {
      setSession(user);
    });
    act(() => {
      setSession(null);
    });

    expect(result.current).toBeNull();
  });
});
