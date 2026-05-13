import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const backendHttpTarget = process.env.VITE_BACKEND_HTTP_URL || "http://127.0.0.1:4173";
const backendWsTarget = process.env.VITE_BACKEND_WS_URL || "ws://127.0.0.1:4173";
const disableHmr = process.env.CODER_STUDIO_DISABLE_HMR === "true";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: true,
    hmr: disableHmr ? false : undefined,
    proxy: {
      "/ws": {
        target: backendWsTarget,
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", (err) => {
            console.log("WS proxy error:", err);
          });
          proxy.on("proxyReqWs", (proxyReq, req, socket) => {
            console.log("WS proxy upgrade:", req.url);
          });
        },
      },
      "/auth": {
        target: backendHttpTarget,
      },
      "/internal": {
        target: backendHttpTarget,
      },
      "/api": {
        target: backendHttpTarget,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("monaco-editor")) {
            return "monaco-editor";
          }

          if (
            id.includes("@xterm/xterm") ||
            id.includes("@xterm+xterm") ||
            id.includes("@xterm/addon-fit") ||
            id.includes("@xterm+addon-fit") ||
            id.includes("@xterm/addon-webgl") ||
            id.includes("@xterm+addon-webgl")
          ) {
            return "xterm";
          }
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    env: {
      NODE_ENV: "test",
    },
    setupFiles: [path.resolve(__dirname, "./src/test-utils/setup.ts")],
  },
});
