import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:4173',
        ws: true,
      },
      '/internal': {
        target: 'http://127.0.0.1:4173',
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'monaco-editor': ['@monaco-editor/react'],
          'xterm': ['xterm', 'xterm-addon-fit', 'xterm-addon-webgl'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-utils/setup.ts'],
  },
});