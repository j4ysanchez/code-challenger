import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import functional from 'eslint-plugin-functional';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'infra/sandbox/**',
      // Fixtures that run inside untrusted sandbox containers, not our own Node/TS build.
      'apps/worker/tests/hostile/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.config.ts', '*.config.js', 'vitest.setup.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: [
      '**/src/kernel/**/*.ts',
      '**/src/features/**/*.ts',
      '**/src/features/**/*.tsx',
    ],
    plugins: { functional },
    rules: {
      'functional/no-let': 'error',
      'functional/immutable-data': 'error',
      'functional/no-throw-statements': 'error',
    },
  },
  {
    // Tests must never send/subscribe to the real production pg-boss queues — doing so
    // races any live `dev:worker`/`dev:api` process for the same jobs and makes the test
    // flaky depending on what else happens to be running locally. Generate a unique
    // per-test queue name instead (see apps/worker/tests/platform.test.ts).
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@code-challenger/contracts',
              importNames: ['EVALUATION_QUEUE_NAME', 'EVALUATION_DEAD_LETTER_QUEUE_NAME'],
              message:
                'Do not use the shared production queue name in a test — it races any live worker process. Generate a unique name instead, e.g. `test-evaluate-${randomUUID()}`.',
            },
          ],
        },
      ],
    },
  },
);
