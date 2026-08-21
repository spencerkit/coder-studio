import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const backendHttpTarget = process.env.VITE_BACKEND_HTTP_URL || "http://127.0.0.1:4173";
const backendWsTarget = process.env.VITE_BACKEND_WS_URL || "ws://127.0.0.1:4173";
const disableHmr = process.env.CODER_STUDIO_DISABLE_HMR === "true";

export default defineConfig(({ command, isPreview, mode }) => {
  if (command === "serve" && !isPreview && process.env.NODE_ENV === "production") {
    process.env.NODE_ENV = "development";
  }

  const isUiPreviewBuild = command === "build" && mode === "ui-preview";

  return {
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
            proxy.on("proxyReqWs", (_proxyReq, req, _socket) => {
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
      modulePreload: false,
      sourcemap: true,
      rollupOptions: {
        input: isUiPreviewBuild
          ? {
              "ui-preview": path.resolve(__dirname, "ui-preview.html"),
            }
          : {
              main: path.resolve(__dirname, "index.html"),
            },
        output: {
          manualChunks(id) {
            const normalizedId = id.split(path.sep).join("/");

            if (normalizedId.endsWith("/src/app.tsx")) {
              return "app-router";
            }

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

            return undefined;
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      // Avoid worker starvation when the Vite build test runs alongside large jsdom suites.
      maxWorkers: 4,
      env: {
        NODE_ENV: "test",
      },
      setupFiles: [path.resolve(__dirname, "./src/test-utils/setup.ts")],
    },
  };
});
