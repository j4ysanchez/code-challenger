const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
};

export const dbEnv = () => ({
  postgresDb: required('POSTGRES_DB'),
  superuserPassword: required('POSTGRES_SUPERUSER_PASSWORD'),
  migratorUrl: required('DATABASE_URL_MIGRATOR'),
  apiUrl: required('DATABASE_URL_API'),
  workerUrl: required('DATABASE_URL_WORKER'),
});

/** Builds the one-time bootstrap connection (Postgres superuser) from the migrator URL's host/port. */
export const superuserUrl = (migratorUrl: string, superuserPassword: string): string => {
  const url = new URL(migratorUrl);
  url.username = 'postgres';
  url.password = superuserPassword;
  return url.toString();
};

export const roleName = (url: string): string => new URL(url).username;

export const rolePassword = (url: string): string => new URL(url).password;

/**
 * Role names and passwords here come from our own trusted `.env`, never from
 * request input, but Postgres DDL (CREATE ROLE, GRANT, …) has no parameter-
 * binding support — so we validate identifiers and escape literals ourselves
 * before building raw SQL.
 */
export const assertSafeIdentifier = (value: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`unsafe SQL identifier: ${value}`);
  }
  return value;
};

export const escapeLiteral = (value: string): string => value.replace(/'/g, "''");
