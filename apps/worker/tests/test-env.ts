/** Reads a required env var for integration tests; throws with a clear message if unset. */
export const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var for test: ${name}`);
  }
  return value;
};
