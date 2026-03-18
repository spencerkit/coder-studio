import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendBase = env.VITE_CODER_STUDIO_BACKEND ?? "";

  return {
    plugins: [
      react(),
      {
        name: "inject-coder-studio-backend",
        transformIndexHtml(html) {
          const injected = `<script>window.__CODER_STUDIO_BACKEND__ = ${JSON.stringify(backendBase)};</script>`;
          return html.replace("</body>", `  ${injected}\n  </body>`);
        }
      }
    ],
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
      port: 5174,
      strictPort: true
    }
  };
});
