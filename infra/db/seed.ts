import argon2 from 'argon2';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { Database } from '../../apps/api/src/platform/db.js';

try {
  process.loadEnvFile();
} catch {
  // no local .env (e.g. CI sets env vars directly on the runner) — ignore
}

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
};

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: requireEnv('DATABASE_URL_API') }),
  }),
});

interface SeedProblem {
  readonly slug: string;
  readonly title: string;
  readonly statementMd: string;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly tags: readonly string[];
  readonly starterCode: { readonly python: string; readonly javascript: string };
  readonly testCases: readonly {
    readonly position: number;
    readonly input: string;
    readonly expectedOutput: string;
    readonly visible: boolean;
  }[];
}

const PROBLEMS: readonly SeedProblem[] = [
  {
    slug: 'sum-two-numbers',
    title: 'Sum Two Numbers',
    statementMd:
      '# Sum Two Numbers\n\nRead two whitespace-separated integers `a` and `b` from stdin and print their sum.\n\n## Example\n\nInput: `2 3`\n\nOutput: `5`\n',
    difficulty: 'easy',
    tags: ['math', 'warmup'],
    starterCode: {
      python: [
        'import sys',
        '',
        '',
        'def main():',
        '    a, b = (int(x) for x in sys.stdin.read().split())',
        '    # TODO: print the sum of a and b',
        '',
        '',
        'if __name__ == "__main__":',
        '    main()',
        '',
      ].join('\n'),
      javascript: [
        "const [a, b] = require('fs')",
        "  .readFileSync(0, 'utf8')",
        '  .trim()',
        '  .split(/\\s+/)',
        '  .map(Number);',
        '',
        '// TODO: print the sum of a and b',
        '',
      ].join('\n'),
    },
    testCases: [
      { position: 0, input: '2 3\n', expectedOutput: '5', visible: true },
      { position: 1, input: '10 15\n', expectedOutput: '25', visible: false },
    ],
  },
  {
    slug: 'reverse-string',
    title: 'Reverse a String',
    statementMd:
      '# Reverse a String\n\nRead a single line from stdin and print it reversed.\n\n## Example\n\nInput: `hello`\n\nOutput: `olleh`\n',
    difficulty: 'easy',
    tags: ['strings', 'warmup'],
    starterCode: {
      python: [
        'import sys',
        '',
        '',
        'def main():',
        '    s = sys.stdin.readline().rstrip("\\n")',
        '    # TODO: print s reversed',
        '',
        '',
        'if __name__ == "__main__":',
        '    main()',
        '',
      ].join('\n'),
      javascript: [
        "const s = require('fs').readFileSync(0, 'utf8').replace(/\\n$/, '');",
        '',
        '// TODO: print s reversed',
        '',
      ].join('\n'),
    },
    testCases: [
      { position: 0, input: 'hello', expectedOutput: 'olleh', visible: true },
      { position: 1, input: 'abcdef', expectedOutput: 'fedcba', visible: false },
    ],
  },
];

const seedUsers = async (): Promise<void> => {
  const admin = {
    email: 'admin@example.com',
    password_hash: await argon2.hash('admin-seed-pw', { type: argon2.argon2id }),
    role: 'admin' as const,
  };
  const member = {
    email: 'member@example.com',
    password_hash: await argon2.hash('member-seed-pw', { type: argon2.argon2id }),
    role: 'member' as const,
  };

  await db
    .insertInto('users')
    .values([admin, member])
    .onConflict((oc) => oc.column('email').doNothing())
    .execute();

  console.log('  seeded users: admin@example.com / member@example.com (password: <role>-seed-pw)');
};

const seedProblem = async (problem: SeedProblem): Promise<void> => {
  const row = await db
    .insertInto('problems')
    .values({
      slug: problem.slug,
      title: problem.title,
      statement_md: problem.statementMd,
      difficulty: problem.difficulty,
      tags: [...problem.tags],
      status: 'published',
    })
    .onConflict((oc) =>
      oc.column('slug').doUpdateSet({
        title: problem.title,
        statement_md: problem.statementMd,
        difficulty: problem.difficulty,
        tags: sql`excluded.tags`,
        status: 'published',
        updated_at: new Date(),
      }),
    )
    .returning('id')
    .executeTakeFirstOrThrow();

  await db
    .insertInto('starter_code')
    .values([
      { problem_id: row.id, language: 'python', code: problem.starterCode.python },
      { problem_id: row.id, language: 'javascript', code: problem.starterCode.javascript },
    ])
    .onConflict((oc) => oc.columns(['problem_id', 'language']).doUpdateSet((eb) => ({ code: eb.ref('excluded.code') })))
    .execute();

  await db.deleteFrom('test_cases').where('problem_id', '=', row.id).execute();
  await db
    .insertInto('test_cases')
    .values(
      problem.testCases.map((testCase) => ({
        problem_id: row.id,
        position: testCase.position,
        input: testCase.input,
        expected_output: testCase.expectedOutput,
        visible: testCase.visible,
      })),
    )
    .execute();

  console.log(`  seeded problem: ${problem.slug}`);
};

const main = async (): Promise<void> => {
  await seedUsers();
  for (const problem of PROBLEMS) {
    await seedProblem(problem);
  }
  await db.destroy();
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
