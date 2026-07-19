import { Kysely, sql } from 'kysely';
import { getConstructionPlans } from 'pg-boss';
import { assertSafeIdentifier, dbEnv, escapeLiteral, roleName, rolePassword } from '../env.js';

const ensureRole = async (db: Kysely<unknown>, role: string, password: string): Promise<void> => {
  await sql.raw(
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
         CREATE ROLE ${role} LOGIN PASSWORD '${password}';
       ELSE
         ALTER ROLE ${role} LOGIN PASSWORD '${password}';
       END IF;
     END $$;`,
  ).execute(db);
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  const env = dbEnv();
  const apiRole = assertSafeIdentifier(roleName(env.apiUrl));
  const workerRole = assertSafeIdentifier(roleName(env.workerUrl));
  const database = assertSafeIdentifier(env.postgresDb);

  await ensureRole(db, apiRole, escapeLiteral(rolePassword(env.apiUrl)));
  await ensureRole(db, workerRole, escapeLiteral(rolePassword(env.workerUrl)));

  await sql.raw(`GRANT CONNECT ON DATABASE ${database} TO ${apiRole}, ${workerRole};`).execute(db);
  await sql.raw(`GRANT USAGE ON SCHEMA public TO ${apiRole}, ${workerRole};`).execute(db);

  // api_role: full CRUD on account/problem-authoring/draft tables + audit append
  await sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, password_reset_tokens TO ${apiRole};`).execute(db);
  await sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON problems, starter_code, test_cases, drafts TO ${apiRole};`).execute(db);
  await sql.raw(`GRANT SELECT, INSERT ON submissions TO ${apiRole};`).execute(db);
  await sql.raw(`GRANT SELECT ON submission_test_results TO ${apiRole};`).execute(db);
  await sql.raw(`GRANT SELECT, INSERT ON audit_events TO ${apiRole};`).execute(db);

  // worker_role: no users/sessions/password_reset_tokens access (constitution Principle II)
  await sql.raw(`GRANT SELECT ON problems, test_cases TO ${workerRole};`).execute(db);
  await sql.raw(`GRANT SELECT, UPDATE ON submissions TO ${workerRole};`).execute(db);
  await sql.raw(`GRANT SELECT, INSERT ON submission_test_results TO ${workerRole};`).execute(db);
  await sql.raw(`GRANT SELECT, INSERT ON audit_events TO ${workerRole};`).execute(db);

  // pg-boss's own job-queue schema: enqueue for api_role, consume/complete for worker_role.
  await sql.raw(`CREATE SCHEMA IF NOT EXISTS pgboss;`).execute(db);
  await sql.raw(`GRANT USAGE, CREATE ON SCHEMA pgboss TO ${apiRole}, ${workerRole};`).execute(db);
  // Default privileges only cover objects THIS role (migrator) creates from here on — so we
  // create pg-boss's schema ourselves, right now, as migrator, instead of leaving it to whichever
  // of api/worker happens to call `boss.start()` first. Otherwise that service's role would own
  // the tables and the other service would get "permission denied" (both need to enqueue/consume).
  await sql.raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT ALL ON TABLES TO ${apiRole}, ${workerRole};`).execute(db);
  await sql.raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT ALL ON SEQUENCES TO ${apiRole}, ${workerRole};`).execute(db);
  await sql.raw(getConstructionPlans('pgboss')).execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  const env = dbEnv();
  const apiRole = assertSafeIdentifier(roleName(env.apiUrl));
  const workerRole = assertSafeIdentifier(roleName(env.workerUrl));
  const database = assertSafeIdentifier(env.postgresDb);

  await sql.raw(`DROP SCHEMA IF EXISTS pgboss CASCADE;`).execute(db);
  await sql.raw(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${apiRole}, ${workerRole};`).execute(db);
  await sql.raw(`REVOKE ALL ON SCHEMA public FROM ${apiRole}, ${workerRole};`).execute(db);
  await sql.raw(`REVOKE ALL ON DATABASE ${database} FROM ${apiRole}, ${workerRole};`).execute(db);
};
