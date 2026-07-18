import { describe, expect, it } from 'vitest';
import {
  adminProblemResponseSchema,
  createProblemRequestSchema,
  createSubmissionRequestSchema,
  draftUpsertRequestSchema,
  firstFailureSchema,
  loginRequestSchema,
  problemDetailResponseSchema,
  problemsListResponseSchema,
  registerRequestSchema,
  replaceTestCasesRequestSchema,
  submissionDetailResponseSchema,
  submissionsHistoryResponseSchema,
} from './index.js';

describe('auth schemas', () => {
  it('accepts a valid register/login payload', () => {
    const payload = { email: 'user@example.com', password: 'hunter22222' };
    expect(registerRequestSchema.safeParse(payload).success).toBe(true);
    expect(loginRequestSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects a payload missing password', () => {
    expect(
      registerRequestSchema.safeParse({ email: 'user@example.com' }).success,
    ).toBe(false);
  });
});

describe('problems schemas', () => {
  it('accepts a published-only catalog response', () => {
    const payload = {
      problems: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          slug: 'two-sum',
          title: 'Two Sum',
          difficulty: 'easy',
          tags: ['array'],
          solved: true,
        },
      ],
    };
    expect(problemsListResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('accepts a problem detail with starter code and visible test cases only', () => {
    const payload = {
      problem: {
        id: '00000000-0000-0000-0000-000000000001',
        slug: 'two-sum',
        title: 'Two Sum',
        statementMd: '# Two Sum',
        difficulty: 'easy',
        tags: ['array'],
        limits: { cpuTimeLimitMs: 2000, wallTimeLimitMs: 10000, memoryLimitMb: 256 },
        starterCode: { python: 'def solve(): ...', javascript: 'function solve() {}' },
        visibleTestCases: [{ input: '1 2', expectedOutput: '3' }],
      },
    };
    expect(problemDetailResponseSchema.safeParse(payload).success).toBe(true);
  });
});

describe('drafts schema', () => {
  it('accepts an upsert within the 100 KB code limit', () => {
    expect(
      draftUpsertRequestSchema.safeParse({
        language: 'python',
        code: 'print(1)',
      }).success,
    ).toBe(true);
  });

  it('rejects an unsupported language', () => {
    expect(
      draftUpsertRequestSchema.safeParse({ language: 'ruby', code: 'x' })
        .success,
    ).toBe(false);
  });
});

describe('submissions schemas', () => {
  it('accepts a create-submission request', () => {
    expect(
      createSubmissionRequestSchema.safeParse({
        language: 'python',
        source: 'print(1)',
      }).success,
    ).toBe(true);
  });

  it('accepts a visible first-failure with input/expected/actual', () => {
    expect(
      firstFailureSchema.safeParse({
        caseIndex: 2,
        visible: true,
        input: '1 2',
        expectedOutput: '3',
        actualOutput: '4',
      }).success,
    ).toBe(true);
  });

  it('rejects a hidden first-failure that leaks input/expected/actual (FR-008)', () => {
    expect(
      firstFailureSchema.safeParse({
        caseIndex: 2,
        visible: false,
        input: '1 2',
      }).success,
    ).toBe(false);
  });

  it('accepts a hidden first-failure with only caseIndex + visible', () => {
    expect(
      firstFailureSchema.safeParse({ caseIndex: 2, visible: false }).success,
    ).toBe(true);
  });

  it('accepts a full submission detail response', () => {
    const payload = {
      submission: {
        id: '00000000-0000-0000-0000-000000000001',
        problemSlug: 'two-sum',
        language: 'python',
        status: 'complete',
        verdict: 'wrong_answer',
        testsPassed: 3,
        testsTotal: 5,
        maxRuntimeMs: 41,
        maxMemoryKb: 12040,
        createdAt: '2026-07-16T00:00:00.000Z',
        completedAt: '2026-07-16T00:00:01.000Z',
        sourceCode: 'print(1)',
        firstFailure: { caseIndex: 4, visible: true, input: 'a', expectedOutput: 'b', actualOutput: 'c' },
      },
    };
    expect(submissionDetailResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('accepts a history response scoped to summaries (no source code)', () => {
    const payload = {
      submissions: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          language: 'python',
          status: 'complete',
          verdict: 'accepted',
          testsPassed: 5,
          testsTotal: 5,
          createdAt: '2026-07-16T00:00:00.000Z',
        },
      ],
    };
    expect(submissionsHistoryResponseSchema.safeParse(payload).success).toBe(
      true,
    );
  });
});

describe('admin-problems schemas', () => {
  it('accepts a full create-problem request', () => {
    expect(
      createProblemRequestSchema.safeParse({
        slug: 'two-sum',
        title: 'Two Sum',
        statementMd: '# Two Sum',
        difficulty: 'easy',
        tags: ['array'],
        limits: { cpuTimeLimitMs: 2000, wallTimeLimitMs: 10000, memoryLimitMb: 256 },
        starterCode: { python: 'pass', javascript: '' },
      }).success,
    ).toBe(true);
  });

  it('accepts an admin problem response including draft status', () => {
    const payload = {
      problem: {
        id: '00000000-0000-0000-0000-000000000001',
        slug: 'two-sum',
        title: 'Two Sum',
        statementMd: '# Two Sum',
        difficulty: 'easy',
        tags: ['array'],
        status: 'draft',
        limits: { cpuTimeLimitMs: 2000, wallTimeLimitMs: 10000, memoryLimitMb: 256 },
        starterCode: { python: 'pass' },
      },
    };
    expect(adminProblemResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('accepts a full ordered test-case replace with visible and hidden cases', () => {
    expect(
      replaceTestCasesRequestSchema.safeParse({
        testCases: [
          { input: '1 2', expectedOutput: '3', visible: true },
          { input: '5 5', expectedOutput: '10', visible: false },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects an empty test-case replace', () => {
    expect(
      replaceTestCasesRequestSchema.safeParse({ testCases: [] }).success,
    ).toBe(false);
  });
});
