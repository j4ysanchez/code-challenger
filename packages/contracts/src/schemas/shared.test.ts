import { describe, expect, it } from 'vitest';
import {
  codeSchema,
  emailSchema,
  passwordSchema,
  resourceLimitsSchema,
  slugSchema,
  tagsSchema,
  titleSchema,
} from './shared.js';

describe('emailSchema', () => {
  it('accepts a well-formed email up to 254 chars', () => {
    const local = 'a'.repeat(242); // 242 + '@x.com' (6) = 248 <= 254
    expect(emailSchema.safeParse(`${local}@x.com`).success).toBe(true);
    expect(emailSchema.safeParse('user@example.com').success).toBe(true);
  });

  it('rejects malformed addresses and addresses over 254 chars', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    const tooLong = `${'a'.repeat(250)}@example.com`; // > 254
    expect(emailSchema.safeParse(tooLong).success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('accepts passwords between 8 and 128 chars', () => {
    expect(passwordSchema.safeParse('a'.repeat(8)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(128)).success).toBe(true);
  });

  it('rejects passwords shorter than 8 or longer than 128 chars', () => {
    expect(passwordSchema.safeParse('a'.repeat(7)).success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });
});

describe('codeSchema', () => {
  it('accepts 1 byte up to 100 KB', () => {
    expect(codeSchema.safeParse('x').success).toBe(true);
    expect(codeSchema.safeParse('x'.repeat(100 * 1024)).success).toBe(true);
  });

  it('rejects empty source and sources over 100 KB', () => {
    expect(codeSchema.safeParse('').success).toBe(false);
    expect(codeSchema.safeParse('x'.repeat(100 * 1024 + 1)).success).toBe(
      false,
    );
  });

  it('measures size in bytes, not characters', () => {
    // multi-byte UTF-8 chars cost more than 1 byte each
    const multiByte = '💻'.repeat(25 * 1024 + 1); // 4 bytes each -> over 100 KB
    expect(codeSchema.safeParse(multiByte).success).toBe(false);
  });
});

describe('slugSchema', () => {
  it('accepts kebab-case slugs up to 64 chars', () => {
    expect(slugSchema.safeParse('two-sum').success).toBe(true);
    expect(slugSchema.safeParse('a').success).toBe(true);
  });

  it('rejects uppercase, spaces, leading/trailing hyphens, and overlong slugs', () => {
    expect(slugSchema.safeParse('Two-Sum').success).toBe(false);
    expect(slugSchema.safeParse('two sum').success).toBe(false);
    expect(slugSchema.safeParse('-two-sum').success).toBe(false);
    expect(slugSchema.safeParse('two-sum-').success).toBe(false);
    expect(slugSchema.safeParse('a'.repeat(65)).success).toBe(false);
  });
});

describe('titleSchema', () => {
  it('accepts non-empty titles up to 200 chars and rejects longer ones', () => {
    expect(titleSchema.safeParse('Two Sum').success).toBe(true);
    expect(titleSchema.safeParse('').success).toBe(false);
    expect(titleSchema.safeParse('a'.repeat(201)).success).toBe(false);
  });
});

describe('tagsSchema', () => {
  it('accepts up to 10 tags of up to 32 chars each', () => {
    expect(tagsSchema.safeParse(['array', 'hash-map']).success).toBe(true);
    expect(tagsSchema.safeParse(Array(10).fill('tag')).success).toBe(true);
  });

  it('rejects more than 10 tags or a tag over 32 chars', () => {
    expect(tagsSchema.safeParse(Array(11).fill('tag')).success).toBe(false);
    expect(tagsSchema.safeParse(['a'.repeat(33)]).success).toBe(false);
  });
});

describe('resourceLimitsSchema', () => {
  it('accepts limits within the documented ranges', () => {
    expect(
      resourceLimitsSchema.safeParse({
        cpuTimeLimitMs: 2000,
        wallTimeLimitMs: 10000,
        memoryLimitMb: 256,
      }).success,
    ).toBe(true);
  });

  it('rejects limits outside cpu 100-10000ms, wall 1000-30000ms, memory 32-1024mb', () => {
    expect(
      resourceLimitsSchema.safeParse({
        cpuTimeLimitMs: 99,
        wallTimeLimitMs: 10000,
        memoryLimitMb: 256,
      }).success,
    ).toBe(false);
    expect(
      resourceLimitsSchema.safeParse({
        cpuTimeLimitMs: 2000,
        wallTimeLimitMs: 30001,
        memoryLimitMb: 256,
      }).success,
    ).toBe(false);
    expect(
      resourceLimitsSchema.safeParse({
        cpuTimeLimitMs: 2000,
        wallTimeLimitMs: 10000,
        memoryLimitMb: 31,
      }).success,
    ).toBe(false);
  });
});
