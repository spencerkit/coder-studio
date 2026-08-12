import { describe, expect, it } from "vitest";
import { createCliBuildOptions } from "./esbuild.js";

describe("createCliBuildOptions", () => {
  it("externalizes third-party runtime dependencies while bundling workspace packages", async () => {
    const options = await createCliBuildOptions("esm");
    const external = options.external as string[];

    expect(external).toContain("@fastify/compress");
    expect(external).toContain("vscode-jsonrpc");
    expect(external).toContain("node-pty");
    expect(external).toContain("pm2");
    expect(external).not.toContain("@coder-studio/server");
  });
});
