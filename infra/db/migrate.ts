import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresDialect } from 'kysely';
import { Migrator, FileMigrationProvider } from 'kysely/migration';
import pg from 'pg';
import { assertSafeIdentifier, dbEnv, escapeLiteral, roleName, rolePassword, superuserUrl } from './env.js';

try {
  process.loadEnvFile();
} catch {
  // no local .env (e.g. CI sets env vars directly on the runner) — ignore
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Roles are bootstrapped with the Postgres superuser because migrator_role
 * (which owns the schema migrations below) does not exist until this step
 * creates it — there is no other account to run the very first migration as.
 */
const bootstrapMigratorRole = async (): Promise<void> => {
  const env = dbEnv();
  const pool = new pg.Pool({ connectionString: superuserUrl(env.migratorUrl, env.superuserPassword) });
  const migrator = assertSafeIdentifier(roleName(env.migratorUrl));
  const password = escapeLiteral(rolePassword(env.migratorUrl));
  const database = assertSafeIdentifier(env.postgresDb);

  try {
    await pool.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${migrator}') THEN
           CREATE ROLE ${migrator} LOGIN PASSWORD '${password}' CREATEROLE;
         ELSE
           ALTER ROLE ${migrator} LOGIN PASSWORD '${password}' CREATEROLE;
         END IF;
       END $$;`,
    );
    await pool.query(`GRANT ALL PRIVILEGES ON DATABASE ${database} TO ${migrator};`);
    await pool.query(`GRANT ALL ON SCHEMA public TO ${migrator};`);
  } finally {
    await pool.end();
  }
};

const runMigrations = async (): Promise<void> => {
  const env = dbEnv();
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: env.migratorUrl }),
    }),
  });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  });

  const { error, results } = await migrator.migrateToLatest();

  for (const result of results ?? []) {
    const outcome = result.status === 'Success' ? 'applied' : 'FAILED';
    console.log(`  [${outcome}] ${result.migrationName}`);
  }

  await db.destroy();

  if (error) {
    console.error(error);
    process.exitCode = 1;
  }
};

const main = async (): Promise<void> => {
  await bootstrapMigratorRole();
  await runMigrations();
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
