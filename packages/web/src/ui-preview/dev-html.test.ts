// @vitest-environment node
import { createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";

const servers: ViteDevServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("ui-preview dev html", () => {
  it("serves the standalone entry with the React refresh preamble even when NODE_ENV is production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      const server = await createServer({
        configFile: "./vite.config.ts",
        logLevel: "silent",
        optimizeDeps: {
          noDiscovery: true,
        },
        server: {
          host: "127.0.0.1",
          port: 0,
        },
      });
      servers.push(server);

      await server.listen();

      const address = server.httpServer?.address();
      const port = typeof address === "object" && address ? address.port : null;

      expect(port).not.toBeNull();

      const html = await fetch(`http://127.0.0.1:${port}/ui-preview.html`).then((response) =>
        response.text()
      );

      expect(html).toContain("/@react-refresh");
      expect(html).toContain("window.$RefreshReg$");
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
