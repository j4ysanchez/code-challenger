import path from 'node:path';
import { defineConfig } from 'vitest/config';

const setupFiles = [path.resolve(import.meta.dirname, './vitest.setup.ts')];

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'contracts',
          root: './packages/contracts',
          environment: 'node',
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'infra',
          root: './infra/db',
          environment: 'node',
          setupFiles,
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'api',
          root: './apps/api',
          environment: 'node',
          setupFiles,
          passWithNoTests: true,
          // solve-loop.e2e.test.ts drives real Docker sandbox containers; running it
          // alongside the other (Postgres-only) api test files oversubscribes host
          // CPU and makes its timing assertions flaky. Sequential files keep it stable.
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'worker',
          root: './apps/worker',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['tests/hostile/**', 'node_modules/**'],
          setupFiles,
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'hostile',
          root: './apps/worker',
          environment: 'node',
          include: ['tests/hostile/**/*.test.ts'],
          setupFiles,
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'jsdom',
          setupFiles: [path.resolve(import.meta.dirname, './apps/web/vitest.setup.ts')],
          passWithNoTests: true,
        },
      },
    ],
  },
});
