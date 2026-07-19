import { Kysely, PostgresDialect, type Generated } from 'kysely';
import pg from 'pg';

/**
 * worker_role's view of the schema (data-model.md / infra/db/migrations/0002_roles_grants.ts):
 * no `users` or `sessions` tables — the worker never needs, and cannot reach, account data.
 */
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

export interface AuditEventsTable {
  id: Generated<string>;
  event_type: string;
  user_id: string | null;
  data: unknown;
  created_at: Generated<Date>;
}

export interface Database {
  problems: ProblemsTable;
  test_cases: TestCasesTable;
  submissions: SubmissionsTable;
  submission_test_results: SubmissionTestResultsTable;
  audit_events: AuditEventsTable;
}

export const createDb = (connectionString: string): Kysely<Database> =>
  new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString }),
    }),
  });
