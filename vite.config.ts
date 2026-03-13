import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
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
    port: 5174,
    strictPort: true
  }
});
