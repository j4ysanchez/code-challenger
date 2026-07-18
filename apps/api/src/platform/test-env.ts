/** Reads a required env var for integration tests; throws with a clear message if unset. */
export const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var for test: ${name}`);
  }
  return value;
};

interface InjectedCookie {
  readonly name: string;
  readonly value: string;
}

/** Grabs the first Set-Cookie from a fastify.inject response; throws if the test's assumption is wrong. */
export const firstCookie = (response: { readonly cookies: readonly InjectedCookie[] }): InjectedCookie => {
  const [cookie] = response.cookies;
  if (!cookie) {
    throw new Error('expected the response to set at least one cookie');
  }
  return cookie;
};
