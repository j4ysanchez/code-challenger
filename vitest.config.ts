import { defineConfig } from 'vitest/config';

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
          name: 'api',
          root: './apps/api',
          environment: 'node',
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'worker',
          root: './apps/worker',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['tests/hostile/**', 'node_modules/**'],
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'hostile',
          root: './apps/worker',
          environment: 'node',
          include: ['tests/hostile/**/*.test.ts'],
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'jsdom',
          passWithNoTests: true,
        },
      },
    ],
  },
});
