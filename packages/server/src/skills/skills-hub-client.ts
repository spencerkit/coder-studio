import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkillsHubSearchOutput } from "./search-parser.js";

export interface SkillsHubExecResult {
  stdout: string;
  stderr: string;
}

export interface SkillsHubClientDeps {
  runCommand: (
    file: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> }
  ) => Promise<SkillsHubExecResult>;
}

export class SkillsHubClient {
  constructor(private readonly deps: SkillsHubClientDeps) {}

  async search(query: string) {
    const result = await this.exec(["search", query, "--limit", "20"]);
    return parseSkillsHubSearchOutput(result.stdout);
  }

  async info(slug: string) {
    const result = await this.exec(["info", slug, "--json"]);
    return JSON.parse(result.stdout) as {
      slug: string;
      name?: string;
      description?: string;
      version?: string;
    };
  }

  async uninstall(slug: string): Promise<void> {
    await this.exec(["uninstall", slug]);
  }

  async stageInstall(slug: string): Promise<{ tempHome: string; exportDir: string }> {
    const tempHome = await mkdtemp(join(tmpdir(), "skills-hub-home-"));
    const exportDir = join(tempHome, "exported");

    await this.exec(["install", slug, "--target", "codex", "--no-save"], {
      env: { HOME: tempHome },
    });
    await this.exec(["sync", "codex", "--output", exportDir], {
      env: { HOME: tempHome },
    });

    return { tempHome, exportDir };
  }

  async readStagedSkill(exportDir: string, slug: string): Promise<string> {
    return readFile(join(exportDir, slug, "SKILL.md"), "utf8");
  }

  async cleanupStage(tempHome: string): Promise<void> {
    await rm(tempHome, { recursive: true, force: true });
  }

  private exec(args: string[], options?: { env?: Record<string, string> }) {
    return this.deps.runCommand("npx", ["-y", "@skills-hub-ai/cli", ...args], options);
  }
}
