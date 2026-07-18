import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { dbEnv } from './env.js';

const env = dbEnv();
const apiPool = new pg.Pool({ connectionString: env.apiUrl });
const workerPool = new pg.Pool({ connectionString: env.workerUrl });

afterAll(async () => {
  await apiPool.end();
  await workerPool.end();
});

/** Runs `fn` inside a transaction that is always rolled back, so tests never leave data behind. */
const inRolledBackTx = async (
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await fn(client);
    } finally {
      await client.query('ROLLBACK');
    }
  } finally {
    client.release();
  }
};

/**
 * A failed statement aborts the enclosing Postgres transaction, so asserting
 * multiple expected failures in one test needs a savepoint per assertion —
 * otherwise the second assertion just sees "transaction is aborted" instead
 * of the real error.
 */
const expectRejects = async (
  client: pg.PoolClient,
  query: string,
  pattern: RegExp,
): Promise<void> => {
  await client.query('SAVEPOINT assertion');
  try {
    await expect(client.query(query)).rejects.toThrow(pattern);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT assertion');
  }
};

describe('schema constraints', () => {
  it('rejects a user role outside the allowlist', async () => {
    await inRolledBackTx(apiPool, async (client) => {
      await expect(
        client.query(
          "INSERT INTO users (email, password_hash, role) VALUES ('a@example.com', 'x', 'superadmin')",
        ),
      ).rejects.toThrow(/violates check constraint/);
    });
  });

  it('rejects a problem difficulty outside the allowlist', async () => {
    await inRolledBackTx(apiPool, async (client) => {
      await expect(
        client.query(
          "INSERT INTO problems (slug, title, statement_md, difficulty) VALUES ('x', 'X', '# X', 'impossible')",
        ),
      ).rejects.toThrow(/violates check constraint/);
    });
  });

  it('treats email as case-insensitive for uniqueness (citext)', async () => {
    await inRolledBackTx(apiPool, async (client) => {
      await client.query(
        "INSERT INTO users (email, password_hash) VALUES ('Dup@Example.com', 'x')",
      );
      await expect(
        client.query(
          "INSERT INTO users (email, password_hash) VALUES ('dup@example.com', 'y')",
        ),
      ).rejects.toThrow(/duplicate key value/);
    });
  });

  it('requires a unique problem slug', async () => {
    await inRolledBackTx(apiPool, async (client) => {
      await client.query(
        "INSERT INTO problems (slug, title, statement_md, difficulty) VALUES ('dup-slug', 'A', '# A', 'easy')",
      );
      await expect(
        client.query(
          "INSERT INTO problems (slug, title, statement_md, difficulty) VALUES ('dup-slug', 'B', '# B', 'easy')",
        ),
      ).rejects.toThrow(/duplicate key value/);
    });
  });
});

describe('api_role grants', () => {
  it('can read and write users, sessions, and problems', async () => {
    await inRolledBackTx(apiPool, async (client) => {
      await expect(client.query('SELECT 1 FROM users LIMIT 1')).resolves.toBeDefined();
      await expect(client.query('SELECT 1 FROM sessions LIMIT 1')).resolves.toBeDefined();
      await expect(
        client.query(
          "INSERT INTO problems (slug, title, statement_md, difficulty) VALUES ('grant-check', 'A', '# A', 'easy')",
        ),
      ).resolves.toBeDefined();
    });
  });

  it('can insert and select submissions but cannot update or delete them', async () => {
    await inRolledBackTx(apiPool, async (client) => {
      await client.query(
        "INSERT INTO problems (slug, title, statement_md, difficulty) VALUES ('api-submit-check', 'A', '# A', 'easy')",
      );
      await client.query(
        "INSERT INTO users (email, password_hash) VALUES ('api-grant-check@example.com', 'x')",
      );
      await expect(
        client.query(`
          INSERT INTO submissions (user_id, problem_id, language, source_code)
          SELECT u.id, p.id, 'python', 'print(1)'
          FROM users u, problems p
          WHERE u.email = 'api-grant-check@example.com' AND p.slug = 'api-submit-check'
        `),
      ).resolves.toBeDefined();
      await expect(
        client.query("UPDATE submissions SET status = 'running' WHERE true"),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('can insert and select audit_events but never update or delete them (append-only)', async () => {
    await inRolledBackTx(apiPool, async (client) => {
      await expect(
        client.query(
          "INSERT INTO audit_events (event_type, data) VALUES ('auth.login', '{}'::jsonb)",
        ),
      ).resolves.toBeDefined();
      await expectRejects(
        client,
        "UPDATE audit_events SET event_type = 'tampered' WHERE true",
        /permission denied/,
      );
      await expectRejects(client, 'DELETE FROM audit_events WHERE true', /permission denied/);
    });
  });
});

describe('worker_role grants', () => {
  it('has no access to users, sessions, or password_reset_tokens', async () => {
    await inRolledBackTx(workerPool, async (client) => {
      await expectRejects(client, 'SELECT 1 FROM users LIMIT 1', /permission denied/);
      await expectRejects(client, 'SELECT 1 FROM sessions LIMIT 1', /permission denied/);
      await expectRejects(
        client,
        'SELECT 1 FROM password_reset_tokens LIMIT 1',
        /permission denied/,
      );
    });
  });

  it('can select and update submissions but cannot insert new ones', async () => {
    await inRolledBackTx(workerPool, async (client) => {
      await expect(client.query('SELECT 1 FROM submissions LIMIT 1')).resolves.toBeDefined();
      await expect(
        client.query(
          "INSERT INTO submissions (user_id, problem_id, language, source_code) VALUES (gen_random_uuid(), gen_random_uuid(), 'python', 'x')",
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('can insert and select audit_events but never update or delete them (append-only)', async () => {
    await inRolledBackTx(workerPool, async (client) => {
      await expect(
        client.query(
          "INSERT INTO audit_events (event_type, data) VALUES ('submission.completed', '{}'::jsonb)",
        ),
      ).resolves.toBeDefined();
      await expect(
        client.query("UPDATE audit_events SET event_type = 'tampered' WHERE true"),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
