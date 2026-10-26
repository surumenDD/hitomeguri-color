import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: {
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    headers: {
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' ws://127.0.0.1:*; worker-src 'self' blob:",
    },
  },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
