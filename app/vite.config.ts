import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const productionCsp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:";
const developmentCsp = productionCsp.replace(
  "connect-src 'self';",
  "connect-src 'self' ws://127.0.0.1:*;",
);

export default defineConfig({
  base: './',
  // Fontsource's small unicode subsets must remain same-origin files under the production CSP.
  build: { assetsInlineLimit: 0 },
  plugins: [
    {
      name: 'development-websocket-csp',
      apply: 'serve',
      transformIndexHtml: (html) =>
        html.replace("connect-src 'self';", "connect-src 'self' ws://127.0.0.1:*;"),
    },
  ],
  server: {
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    headers: { 'Content-Security-Policy': developmentCsp },
  },
  // Vite preview inherits server.headers unless explicitly overridden.
  preview: { headers: { 'Content-Security-Policy': productionCsp } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
