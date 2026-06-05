import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Resolve the internal gateway target for the dev proxy.
 *
 * The platform injects BACKEND_URL into the frontend env. On a PC it is
 * `http://localhost:<port>` and works as a proxy target directly. In the Bit
 * cloud workspace it is an external URL like
 * `https://<id>p5000.workspaces.bit.cloud` where the port is encoded in the
 * sub-domain — we extract it and proxy to `http://localhost:<port>` so the
 * frontend talks to the gateway same-origin (no CORS in preview).
 */
function gatewayTarget() {
  const url = process.env.BACKEND_URL || 'http://localhost:5000';
  if (url.includes('localhost') || url.includes('127.0.0.1')) return url;
  const m = url.match(/p(\d+)\.workspaces\.bit\.cloud/);
  if (m) return `http://localhost:${m[1]}`;
  return url;
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/trader-service': {
        target: gatewayTarget(),
        changeOrigin: true,
      },
    },
  },
});
