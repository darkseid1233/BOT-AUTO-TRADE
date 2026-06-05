/**
 * Vite config for the standalone Railway build of trader-dashboard.
 * The API lives at /trader-service/api/* on the same server — no proxy needed.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '../alpaca-trader/trader-dashboard',
  build: {
    outDir: '../../deploy/public',
    emptyOutDir: true,
  },
  define: {
    // In production, the dashboard talks to the same Express server — no BACKEND_URL needed
    'process.env.BACKEND_URL': JSON.stringify(''),
  },
});
