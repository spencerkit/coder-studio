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
          manualChunks: {
            react: ["react", "react-dom"],
            tauri: ["@tauri-apps/api", "@tauri-apps/plugin-dialog"],
            terminal: ["@xterm/xterm", "@xterm/addon-fit"]
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
