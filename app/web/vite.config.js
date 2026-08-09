import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    host: true,
    // In local development the API runs separately; in the cluster nginx
    // proxies /api to the api Service, so the frontend code never needs to
    // know an API hostname in either case.
    proxy: {
      '/api': { target: process.env.API_URL || 'http://localhost:3000', changeOrigin: true },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
    // Users are on 2 GB Android phones over 240 kbps 3G. A bundle-size budget
    // is a functional requirement here (NFR-04), not a nicety.
    chunkSizeWarningLimit: 250,
    rollupOptions: {
      output: {
        manualChunks: { vendor: ['react', 'react-dom'] },
      },
    },
  },

  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
