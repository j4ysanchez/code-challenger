import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

try {
  process.loadEnvFile('../../.env');
} catch {
  // no local .env (e.g. CI/production inject env directly) — ignore
}

const apiPort = process.env['API_PORT'] ?? '3000';
const webPort = Number(process.env['WEB_PORT'] ?? '5173');

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
