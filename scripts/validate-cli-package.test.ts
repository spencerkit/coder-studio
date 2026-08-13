import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "tar";
import { describe, expect, it } from "vitest";
import { validateCliPackageArchive } from "./validate-cli-package.js";

interface PackageFixtureOptions {
  binContent?: string;
  includeTypes?: boolean;
  packedManifest?: Record<string, unknown>;
}

const sourceManifest = {
  name: "@spencer-kit/coder-studio",
  version: "1.2.3",
  main: "./src/index.ts",
  bin: { "coder-studio": "./src/bin.ts" },
  exports: {
    ".": {
      import: "./src/index.ts",
      types: "./src/index.ts",
    },
  },
  publishConfig: {
    main: "./dist/esm/index.mjs",
    bin: { "coder-studio": "./dist/bin.js" },
    exports: {
      ".": {
        import: "./dist/esm/index.mjs",
        types: "./dist/esm/index.d.ts",
      },
    },
  },
};

const validPackedManifest = {
  name: sourceManifest.name,
  version: sourceManifest.version,
  main: sourceManifest.publishConfig.main,
  bin: sourceManifest.publishConfig.bin,
  exports: sourceManifest.publishConfig.exports,
};

describe("validate-cli-package", () => {
  it("accepts package entry fields that resolve to real archive files", async () => {
    const fixture = await createPackageFixture();

    await expect(validateCliPackageArchive(fixture)).resolves.toEqual({
      entryTargets: ["./dist/bin.js", "./dist/esm/index.d.ts", "./dist/esm/index.mjs"],
      name: "@spencer-kit/coder-studio",
      version: "1.2.3",
    });
  });

  it("rejects package entry fields that point to missing archive files", async () => {
    const fixture = await createPackageFixture({ includeTypes: false });

    await expect(validateCliPackageArchive(fixture)).rejects.toThrow(
      'exports...types points to missing file "./dist/esm/index.d.ts"'
    );
  });

  it("rejects an existing bin target without a Node.js shebang", async () => {
    const fixture = await createPackageFixture({ binContent: 'import "./esm/bin.mjs";\n' });

    await expect(validateCliPackageArchive(fixture)).rejects.toThrow(
      'bin.coder-studio is not an executable Node.js entry: "./dist/bin.js"'
    );
  });

  it("rejects a packed manifest that did not apply publishConfig", async () => {
    const fixture = await createPackageFixture({ packedManifest: sourceManifest });

    await expect(validateCliPackageArchive(fixture)).rejects.toThrow(
      "Packed CLI package.json still contains publishConfig"
    );
  });
});

async function createPackageFixture({
  binContent = '#!/usr/bin/env node\nimport "./esm/index.mjs";\n',
  includeTypes = true,
  packedManifest = validPackedManifest,
}: PackageFixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "coder-studio-package-validation-"));
  const packageDir = join(root, "package");
  const sourcePackageJsonPath = join(root, "source-package.json");
  const tarballPath = join(root, "package.tgz");

  await mkdir(join(packageDir, "dist", "esm"), { recursive: true });
  await writeFile(sourcePackageJsonPath, JSON.stringify(sourceManifest));
  await writeFile(join(packageDir, "package.json"), JSON.stringify(packedManifest));
  await writeFile(join(packageDir, "dist", "bin.js"), binContent);
  await writeFile(join(packageDir, "dist", "esm", "index.mjs"), "export {};\n");
  if (includeTypes) {
    await writeFile(join(packageDir, "dist", "esm", "index.d.ts"), "export {};\n");
  }
  await create({ cwd: root, file: tarballPath, gzip: true }, ["package"]);

  return { sourcePackageJsonPath, tarballPath };
}
