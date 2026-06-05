import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Vite runs from deploy/ but source root is the dashboard dir.
// We must tell Rollup to resolve react/etc from deploy/node_modules/
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, '../alpaca-trader/trader-dashboard'),
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router-dom', 'recharts'],
    alias: {
      'react/jsx-runtime': resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
      'react': resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
      'react-router-dom': resolve(__dirname, 'node_modules/react-router-dom'),
      'recharts': resolve(__dirname, 'node_modules/recharts'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'public'),
    emptyOutDir: true,
  },
  define: {
    'process.env.BACKEND_URL': JSON.stringify(''),
  },
});
