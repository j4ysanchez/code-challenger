import { Kysely, sql } from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`CREATE EXTENSION IF NOT EXISTS citext;`.execute(db);

  await sql`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email citext NOT NULL UNIQUE,
      password_hash text NOT NULL,
      role text NOT NULL CHECK (role IN ('member', 'admin')) DEFAULT 'member',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );
  `.execute(db);
  await sql`CREATE INDEX sessions_user_id_idx ON sessions (user_id);`.execute(db);

  await sql`
    CREATE TABLE password_reset_tokens (
      token_hash text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz
    );
  `.execute(db);
  await sql`CREATE INDEX password_reset_tokens_user_id_idx ON password_reset_tokens (user_id);`.execute(db);

  await sql`
    CREATE TABLE problems (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL UNIQUE,
      title text NOT NULL,
      statement_md text NOT NULL,
      difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
      tags text[] NOT NULL DEFAULT '{}',
      status text NOT NULL CHECK (status IN ('draft', 'published')) DEFAULT 'draft',
      cpu_time_limit_ms int NOT NULL DEFAULT 2000,
      wall_time_limit_ms int NOT NULL DEFAULT 10000,
      memory_limit_mb int NOT NULL DEFAULT 256,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);
  await sql`CREATE INDEX problems_status_idx ON problems (status);`.execute(db);

  await sql`
    CREATE TABLE starter_code (
      problem_id uuid NOT NULL REFERENCES problems (id) ON DELETE CASCADE,
      language text NOT NULL CHECK (language IN ('python', 'javascript')),
      code text NOT NULL,
      PRIMARY KEY (problem_id, language)
    );
  `.execute(db);

  await sql`
    CREATE TABLE test_cases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      problem_id uuid NOT NULL REFERENCES problems (id) ON DELETE CASCADE,
      "position" int NOT NULL,
      input text NOT NULL,
      expected_output text NOT NULL,
      visible boolean NOT NULL,
      UNIQUE (problem_id, "position")
    );
  `.execute(db);

  await sql`
    CREATE TABLE submissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id),
      problem_id uuid NOT NULL REFERENCES problems (id),
      language text NOT NULL CHECK (language IN ('python', 'javascript')),
      source_code text NOT NULL,
      status text NOT NULL CHECK (status IN ('queued', 'running', 'complete')) DEFAULT 'queued',
      verdict text CHECK (
        verdict IN (
          'accepted', 'wrong_answer', 'time_limit_exceeded',
          'memory_limit_exceeded', 'runtime_error', 'compile_error', 'system_error'
        )
      ),
      tests_passed int,
      tests_total int,
      max_runtime_ms int,
      max_memory_kb int,
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );
  `.execute(db);
  await sql`CREATE INDEX submissions_history_idx ON submissions (user_id, problem_id, created_at DESC);`.execute(db);
  await sql`
    CREATE INDEX submissions_solved_idx ON submissions (problem_id, user_id, verdict)
    WHERE verdict = 'accepted';
  `.execute(db);

  await sql`
    CREATE TABLE submission_test_results (
      submission_id uuid NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
      test_case_id uuid NOT NULL REFERENCES test_cases (id),
      "position" int NOT NULL,
      passed boolean NOT NULL,
      runtime_ms int NOT NULL,
      memory_kb int NOT NULL,
      actual_output text,
      PRIMARY KEY (submission_id, test_case_id)
    );
  `.execute(db);

  await sql`
    CREATE TABLE drafts (
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      problem_id uuid NOT NULL REFERENCES problems (id) ON DELETE CASCADE,
      language text NOT NULL CHECK (language IN ('python', 'javascript')),
      code text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, problem_id, language)
    );
  `.execute(db);

  await sql`
    CREATE TABLE audit_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      event_type text NOT NULL,
      user_id uuid,
      data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);
  await sql`CREATE INDEX audit_events_event_type_idx ON audit_events (event_type);`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`DROP TABLE IF EXISTS audit_events;`.execute(db);
  await sql`DROP TABLE IF EXISTS drafts;`.execute(db);
  await sql`DROP TABLE IF EXISTS submission_test_results;`.execute(db);
  await sql`DROP TABLE IF EXISTS submissions;`.execute(db);
  await sql`DROP TABLE IF EXISTS test_cases;`.execute(db);
  await sql`DROP TABLE IF EXISTS starter_code;`.execute(db);
  await sql`DROP TABLE IF EXISTS problems;`.execute(db);
  await sql`DROP TABLE IF EXISTS password_reset_tokens;`.execute(db);
  await sql`DROP TABLE IF EXISTS sessions;`.execute(db);
  await sql`DROP TABLE IF EXISTS users;`.execute(db);
};
