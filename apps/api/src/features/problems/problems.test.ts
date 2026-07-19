import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { createLogger } from '../../platform/logger.js';
import { createDb, type Database } from '../../platform/db.js';
import { requireEnv } from '../../platform/test-env.js';
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

const buildTestApp = async (): Promise<{ app: App; db: Kysely<Database> }> => {
  const db = createDb(databaseUrl);
  const app = await buildApp({ config: testConfig, logger: createLogger({ level: 'silent' }) });
  registerProblemsRoutes(app, { db });
  return { app, db };
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
  await migratorDb.deleteFrom('problems').where('slug', 'like', 'problems-test-%').execute();
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
