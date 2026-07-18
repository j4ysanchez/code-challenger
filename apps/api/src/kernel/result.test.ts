import { describe, expect, it, vi } from 'vitest';
import { andThen, err, isErr, isOk, map, mapErr, ok, unwrapOr } from './result.js';

describe('ok/err constructors', () => {
  it('creates a successful result carrying the value', () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('creates a failed result carrying the error', () => {
    const result = err('boom');
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
    expect(result).toEqual({ ok: false, error: 'boom' });
  });
});

describe('map', () => {
  it('transforms the value of an Ok result', () => {
    expect(map(ok(2), (n) => n * 2)).toEqual({ ok: true, value: 4 });
  });

  it('passes an Err result through unchanged', () => {
    const result = err<string, number>('boom');
    expect(map(result, (n) => n * 2)).toEqual({ ok: false, error: 'boom' });
  });
});

describe('mapErr', () => {
  it('transforms the error of an Err result', () => {
    expect(mapErr(err('boom'), (e) => e.toUpperCase())).toEqual({
      ok: false,
      error: 'BOOM',
    });
  });

  it('passes an Ok result through unchanged', () => {
    const result = ok<number, string>(2);
    expect(mapErr(result, (e) => e.toUpperCase())).toEqual({ ok: true, value: 2 });
  });
});

describe('andThen', () => {
  it('chains a fallible transformation on an Ok result', () => {
    const halveIfEven = (n: number) => (n % 2 === 0 ? ok(n / 2) : err('odd'));
    expect(andThen(ok(4), halveIfEven)).toEqual({ ok: true, value: 2 });
    expect(andThen(ok(3), halveIfEven)).toEqual({ ok: false, error: 'odd' });
  });

  it('short-circuits an Err result without calling the transformation', () => {
    const transform = vi.fn((n: number) => ok(n));
    const result = andThen(err<string, number>('boom'), transform);
    expect(result).toEqual({ ok: false, error: 'boom' });
    expect(transform).not.toHaveBeenCalled();
  });
});

describe('unwrapOr', () => {
  it('returns the value for Ok', () => {
    expect(unwrapOr(ok(5), 0)).toBe(5);
  });

  it('returns the fallback for Err', () => {
    expect(unwrapOr(err('boom'), 0)).toBe(0);
  });
});
