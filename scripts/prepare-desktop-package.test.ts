import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { repairPortableNodeLaunchers } from "./prepare-desktop-package.js";

const execFileAsync = promisify(execFile);
const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function createEngineFixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "coder-studio-engine-launcher-test-"));
  cleanupRoots.push(root);
  const targets = {
    "lib/node_modules/corepack/dist/corepack.js": "corepack",
    "lib/node_modules/npm/bin/npm-cli.js": "npm",
    "lib/node_modules/npm/bin/npx-cli.js": "npx",
  };
  await mkdir(resolve(root, "bin"), { recursive: true });
  await Promise.all(
    Object.entries(targets).map(async ([path, name]) => {
      const destination = resolve(root, ...path.split("/"));
      await mkdir(resolve(destination, ".."), { recursive: true });
      await writeFile(destination, `process.stdout.write(${JSON.stringify(name)});\n`);
    })
  );
  return root;
}

describe("prepare-desktop-package", () => {
  it("replaces dereferenced POSIX package-manager entries with portable launchers", async () => {
    const root = await createEngineFixture();

    await repairPortableNodeLaunchers(root, "linux");

    for (const name of ["corepack", "npm", "npx"]) {
      const launcher = resolve(root, "bin", name);
      const source = await readFile(launcher, "utf8");
      expect(source).toContain("../lib/node_modules/");
      expect(source).toContain('exec "$bin_dir/node"');
      if (process.platform !== "win32") {
        expect((await stat(launcher)).mode & 0o111).not.toBe(0);
        await expect(execFileAsync(launcher)).resolves.toMatchObject({ stdout: name });
      }
    }
  });

  it("does not replace launchers from the Windows Node archive", async () => {
    const root = await createEngineFixture();
    const npmPath = resolve(root, "bin", "npm");
    await writeFile(npmPath, "windows-launcher");

    await repairPortableNodeLaunchers(root, "win32");

    await access(npmPath);
    await expect(readFile(npmPath, "utf8")).resolves.toBe("windows-launcher");
  });
});
