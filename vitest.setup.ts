try {
  process.loadEnvFile();
} catch {
  // no local .env (e.g. CI sets env vars directly on the runner) — ignore
}
