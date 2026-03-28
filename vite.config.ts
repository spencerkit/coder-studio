import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const WEB_ROOT = path.resolve('apps/web');
const BUILD_WEB_DIR = path.resolve('.build/web/dist');
const VITE_CACHE_DIR = path.resolve('.build/vite');

const readPort = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export default defineConfig(({ mode }) => {
  loadEnv(mode, process.cwd(), '');
  const frontendPort = readPort(process.env.CODER_STUDIO_DEV_FRONTEND_PORT, 5174);
  const backendPort = readPort(process.env.CODER_STUDIO_DEV_BACKEND_PORT, 41033);
  const backendOrigin = `http://127.0.0.1:${backendPort}`;

  return {
    root: WEB_ROOT,
    cacheDir: VITE_CACHE_DIR,
    plugins: [react()],
    build: {
      outDir: BUILD_WEB_DIR,
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/react/') || id.includes('/react-dom/')) return 'react';
            if (id.includes('/@xterm/xterm/') || id.includes('/@xterm/addon-fit/')) return 'terminal';
            return undefined;
          },
        },
      },
    },
    server: {
      host: '127.0.0.1',
      port: frontendPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: backendOrigin,
          changeOrigin: true,
        },
        '/health': {
          target: backendOrigin,
          changeOrigin: true,
        },
        '/ws': {
          target: backendOrigin,
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
