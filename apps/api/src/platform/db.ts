import { Kysely, PostgresDialect, type Generated } from 'kysely';
import pg from 'pg';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  role: Generated<'member' | 'admin'>;
  created_at: Generated<Date>;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  created_at: Generated<Date>;
  expires_at: Date;
}

export interface PasswordResetTokensTable {
  token_hash: string;
  user_id: string;
  expires_at: Date;
  used_at: Date | null;
}

export interface ProblemsTable {
  id: Generated<string>;
  slug: string;
  title: string;
  statement_md: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: Generated<string[]>;
  status: Generated<'draft' | 'published'>;
  cpu_time_limit_ms: Generated<number>;
  wall_time_limit_ms: Generated<number>;
  memory_limit_mb: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface StarterCodeTable {
  problem_id: string;
  language: 'python' | 'javascript';
  code: string;
}

export interface TestCasesTable {
  id: Generated<string>;
  problem_id: string;
  position: number;
  input: string;
  expected_output: string;
  visible: boolean;
}

export interface SubmissionsTable {
  id: Generated<string>;
  user_id: string;
  problem_id: string;
  language: 'python' | 'javascript';
  source_code: string;
  status: Generated<'queued' | 'running' | 'complete'>;
  verdict:
    | 'accepted'
    | 'wrong_answer'
    | 'time_limit_exceeded'
    | 'memory_limit_exceeded'
    | 'runtime_error'
    | 'compile_error'
    | 'system_error'
    | null;
  tests_passed: number | null;
  tests_total: number | null;
  max_runtime_ms: number | null;
  max_memory_kb: number | null;
  created_at: Generated<Date>;
  completed_at: Date | null;
}

export interface SubmissionTestResultsTable {
  submission_id: string;
  test_case_id: string;
  position: number;
  passed: boolean;
  runtime_ms: number;
  memory_kb: number;
  actual_output: string | null;
}

export interface DraftsTable {
  user_id: string;
  problem_id: string;
  language: 'python' | 'javascript';
  code: string;
  updated_at: Generated<Date>;
}

export interface AuditEventsTable {
  id: Generated<string>;
  event_type: string;
  user_id: string | null;
  data: unknown;
  created_at: Generated<Date>;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  password_reset_tokens: PasswordResetTokensTable;
  problems: ProblemsTable;
  starter_code: StarterCodeTable;
  test_cases: TestCasesTable;
  submissions: SubmissionsTable;
  submission_test_results: SubmissionTestResultsTable;
  drafts: DraftsTable;
  audit_events: AuditEventsTable;
}

export const createDb = (connectionString: string): Kysely<Database> =>
  new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString }),
    }),
  });
