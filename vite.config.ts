import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const DEV_FRONTEND_PORT = 5174;
const DEV_BACKEND_PORT = 41033;
const DEV_BACKEND_ORIGIN = `http://127.0.0.1:${DEV_BACKEND_PORT}`;

export default defineConfig(({ mode }) => {
  loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("/react/") || id.includes("/react-dom/")) return "react";
            if (id.includes("/@tauri-apps/api/") || id.includes("/@tauri-apps/plugin-dialog/")) return "tauri";
            if (id.includes("/@xterm/xterm/") || id.includes("/@xterm/addon-fit/")) return "terminal";
            return undefined;
          }
        }
      }
    },
    server: {
      host: "127.0.0.1",
      port: DEV_FRONTEND_PORT,
      strictPort: true,
      proxy: {
        "/api": {
          target: DEV_BACKEND_ORIGIN,
          changeOrigin: true
        },
        "/health": {
          target: DEV_BACKEND_ORIGIN,
          changeOrigin: true
        },
        "/ws": {
          target: DEV_BACKEND_ORIGIN,
          ws: true,
          changeOrigin: true
        }
      }
    }
  };
});
