import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { createLogger } from '../../platform/logger.js';
import { createDb, type Database } from '../../platform/db.js';
import type { Clock } from '../../platform/clock.js';
import { firstCookie, requireEnv } from '../../platform/test-env.js';
import { registerAuthRoutes } from '../auth/auth.js';
import { registerProblemsRoutes } from './problems.js';
import type { Kysely } from 'kysely';

const databaseUrl = requireEnv('DATABASE_URL_API');
const migratorDb = createDb(requireEnv('DATABASE_URL_MIGRATOR'));

const testConfig = {
  databaseUrl,
  sessionCookieSecret: 'a'.repeat(32),
  port: 3000,
  appOrigin: 'http://localhost:5173',
  nodeEnv: 'test' as const,
};

class FakeClock implements Clock {
  private current: Date;
  constructor(start: Date) {
    this.current = start;
  }
  now(): Date {
    return this.current;
  }
}

const uniqueEmail = (): string => `problems-test-${Math.random().toString(36).slice(2)}@example.com`;

const buildTestApp = async (): Promise<{ app: App; db: Kysely<Database> }> => {
  const db = createDb(databaseUrl);
  const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
  const clock = new FakeClock(new Date());
  registerAuthRoutes(app, { db, clock, config: testConfig });
  registerProblemsRoutes(app, { db, clock });
  return { app, db };
};

const withOrigin = (headers: Record<string, string> = {}): Record<string, string> => ({
  origin: testConfig.appOrigin,
  ...headers,
});

const registerAndLogin = async (app: App, email: string, password: string): Promise<{ name: string; value: string }> => {
  await app.inject({ method: 'POST', url: '/api/auth/register', headers: withOrigin(), payload: { email, password } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: withOrigin(), payload: { email, password } });
  return firstCookie(login);
};

interface SeedOptions {
  readonly slug: string;
  readonly title: string;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly tags: readonly string[];
  readonly status: 'draft' | 'published';
}

const seedProblem = async (db: Kysely<Database>, options: SeedOptions): Promise<string> => {
  const row = await db
    .insertInto('problems')
    .values({
      slug: options.slug,
      title: options.title,
      statement_md: '# statement',
      difficulty: options.difficulty,
      tags: [...options.tags],
      status: options.status,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  await db
    .insertInto('starter_code')
    .values([
      { problem_id: row.id, language: 'python', code: 'pass' },
      { problem_id: row.id, language: 'javascript', code: '// starter' },
    ])
    .execute();

  await db
    .insertInto('test_cases')
    .values([
      { problem_id: row.id, position: 0, input: 'in0', expected_output: 'out0', visible: true },
      { problem_id: row.id, position: 1, input: 'in1', expected_output: 'out1', visible: false },
    ])
    .execute();

  return row.id;
};

afterAll(async () => {
  await migratorDb.deleteFrom('submissions').where('source_code', '=', 'print(1)').execute();
  await migratorDb.deleteFrom('problems').where('slug', 'like', 'problems-test-%').execute();
  await migratorDb.deleteFrom('sessions').execute();
  await migratorDb.deleteFrom('users').where('email', 'like', 'problems-test-%').execute();
  await migratorDb.destroy();
});

describe('GET /api/problems', () => {
  it('returns only published problems, without hidden test cases', async () => {
    const { app, db } = await buildTestApp();
    const slug = `problems-test-published-${randomUUID()}`;
    const draftSlug = `problems-test-draft-${randomUUID()}`;
    await seedProblem(db, { slug, title: 'Published', difficulty: 'easy', tags: ['a'], status: 'published' });
    await seedProblem(db, { slug: draftSlug, title: 'Draft', difficulty: 'easy', tags: ['a'], status: 'draft' });

    const response = await app.inject({ method: 'GET', url: '/api/problems' });
    expect(response.statusCode).toBe(200);
    const slugs = response.json().problems.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain(slug);
    expect(slugs).not.toContain(draftSlug);
  });

  it('filters by difficulty', async () => {
    const { app, db } = await buildTestApp();
    const easySlug = `problems-test-easy-${randomUUID()}`;
    const hardSlug = `problems-test-hard-${randomUUID()}`;
    await seedProblem(db, { slug: easySlug, title: 'Easy', difficulty: 'easy', tags: [], status: 'published' });
    await seedProblem(db, { slug: hardSlug, title: 'Hard', difficulty: 'hard', tags: [], status: 'published' });

    const response = await app.inject({ method: 'GET', url: '/api/problems?difficulty=hard' });
    expect(response.statusCode).toBe(200);
    const slugs = response.json().problems.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain(hardSlug);
    expect(slugs).not.toContain(easySlug);
  });

  it('filters by tag', async () => {
    const { app, db } = await buildTestApp();
    const taggedSlug = `problems-test-tagged-${randomUUID()}`;
    const untaggedSlug = `problems-test-untagged-${randomUUID()}`;
    await seedProblem(db, { slug: taggedSlug, title: 'Tagged', difficulty: 'easy', tags: ['graphs'], status: 'published' });
    await seedProblem(db, { slug: untaggedSlug, title: 'Untagged', difficulty: 'easy', tags: ['strings'], status: 'published' });

    const response = await app.inject({ method: 'GET', url: '/api/problems?tag=graphs' });
    expect(response.statusCode).toBe(200);
    const slugs = response.json().problems.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain(taggedSlug);
    expect(slugs).not.toContain(untaggedSlug);
  });

  it('returns 422 for an invalid difficulty', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/problems?difficulty=impossible' });
    expect(response.statusCode).toBe(422);
  });
});

describe('GET /api/problems/:slug', () => {
  it('returns the full detail shape for a published problem, visible cases only', async () => {
    const { app, db } = await buildTestApp();
    const slug = `problems-test-detail-${randomUUID()}`;
    await seedProblem(db, { slug, title: 'Detail', difficulty: 'medium', tags: ['x'], status: 'published' });

    const response = await app.inject({ method: 'GET', url: `/api/problems/${slug}` });
    expect(response.statusCode).toBe(200);
    const { problem } = response.json();
    expect(problem.slug).toBe(slug);
    expect(problem.statementMd).toBe('# statement');
    expect(problem.limits).toEqual({ cpuTimeLimitMs: 2000, wallTimeLimitMs: 10000, memoryLimitMb: 256 });
    expect(problem.starterCode).toEqual({ python: 'pass', javascript: '// starter' });
    expect(problem.visibleTestCases).toEqual([{ input: 'in0', expectedOutput: 'out0' }]);
  });

  it('returns 404 for a draft problem', async () => {
    const { app, db } = await buildTestApp();
    const slug = `problems-test-hidden-draft-${randomUUID()}`;
    await seedProblem(db, { slug, title: 'Hidden', difficulty: 'easy', tags: [], status: 'draft' });

    const response = await app.inject({ method: 'GET', url: `/api/problems/${slug}` });
    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for an unknown slug', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/problems/does-not-exist' });
    expect(response.statusCode).toBe(404);
  });
});

describe('solved status (US2)', () => {
  it('GET /api/problems: true only for the accepted problem, for the solving user; false/absent for anonymous', async () => {
    const { app, db } = await buildTestApp();
    const solvedSlug = `problems-test-solved-${randomUUID()}`;
    const unsolvedSlug = `problems-test-unsolved-${randomUUID()}`;
    const solvedId = await seedProblem(db, { slug: solvedSlug, title: 'Solved', difficulty: 'easy', tags: [], status: 'published' });
    await seedProblem(db, { slug: unsolvedSlug, title: 'Unsolved', difficulty: 'easy', tags: [], status: 'published' });

    const email = uniqueEmail();
    const cookie = await registerAndLogin(app, email, 'a-fine-password');
    const user = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirstOrThrow();

    await db
      .insertInto('submissions')
      .values({
        user_id: user.id,
        problem_id: solvedId,
        language: 'python',
        source_code: 'print(1)',
        status: 'complete',
        verdict: 'accepted',
        tests_passed: 2,
        tests_total: 2,
        completed_at: new Date(),
      })
      .execute();

    const asOwner = await app.inject({
      method: 'GET',
      url: '/api/problems',
      cookies: { [cookie.name]: cookie.value },
    });
    const ownerProblems = asOwner.json().problems as { slug: string; solved?: boolean }[];
    expect(ownerProblems.find((p) => p.slug === solvedSlug)?.solved).toBe(true);
    expect(ownerProblems.find((p) => p.slug === unsolvedSlug)?.solved).toBeFalsy();

    const anonymous = await app.inject({ method: 'GET', url: '/api/problems' });
    const anonProblems = anonymous.json().problems as { slug: string; solved?: boolean }[];
    const anonSolved = anonProblems.find((p) => p.slug === solvedSlug)?.solved;
    expect(anonSolved === false || anonSolved === undefined).toBe(true);
  });

  it('GET /api/problems/:slug: solved flag reflects the accepted-verdict partial index for the caller only', async () => {
    const { app, db } = await buildTestApp();
    const slug = `problems-test-detail-solved-${randomUUID()}`;
    const problemId = await seedProblem(db, { slug, title: 'Detail Solved', difficulty: 'easy', tags: [], status: 'published' });

    const solverEmail = uniqueEmail();
    const solverCookie = await registerAndLogin(app, solverEmail, 'a-fine-password');
    const solver = await db.selectFrom('users').select('id').where('email', '=', solverEmail).executeTakeFirstOrThrow();
    await db
      .insertInto('submissions')
      .values({
        user_id: solver.id,
        problem_id: problemId,
        language: 'python',
        source_code: 'print(1)',
        status: 'complete',
        verdict: 'accepted',
        tests_passed: 1,
        tests_total: 1,
        completed_at: new Date(),
      })
      .execute();

    const otherEmail = uniqueEmail();
    const otherCookie = await registerAndLogin(app, otherEmail, 'a-fine-password');

    const solverResponse = await app.inject({
      method: 'GET',
      url: `/api/problems/${slug}`,
      cookies: { [solverCookie.name]: solverCookie.value },
    });
    expect(solverResponse.json().problem.solved).toBe(true);

    const otherResponse = await app.inject({
      method: 'GET',
      url: `/api/problems/${slug}`,
      cookies: { [otherCookie.name]: otherCookie.value },
    });
    expect(otherResponse.json().problem.solved).toBeFalsy();

    const anonymousResponse = await app.inject({ method: 'GET', url: `/api/problems/${slug}` });
    const anonSolved = anonymousResponse.json().problem.solved;
    expect(anonSolved === false || anonSolved === undefined).toBe(true);
  });
});
