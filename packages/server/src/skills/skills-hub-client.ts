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
    options?: { cwd?: string; env?: NodeJS.ProcessEnv }
  ) => Promise<SkillsHubExecResult>;
}

export class SkillsHubClient {
  constructor(private readonly deps: SkillsHubClientDeps) {}

  async search(query: string) {
    const result = await this.exec(["search", query, "--limit", "20", "--json"]);
    return parseSkillsHubSearchOutput(result.stdout);
  }

  async info(slug: string): Promise<{
    slug: string;
    name?: string;
    description?: string;
    version?: string;
  }> {
    const result = await this.exec(["search", slug, "--limit", "50", "--json"]);
    const rows = parseSkillsHubSearchOutput(result.stdout);
    const exact = rows.find((row) => row.slug === slug);
    if (!exact) {
      throw new Error(`Skill not found: ${slug}`);
    }

    return {
      slug: exact.slug,
      name: exact.displayName,
      description: exact.description,
      version: exact.version,
    };
  }

  async uninstall(slug: string): Promise<void> {
    await this.exec(["uninstall", slug]);
  }

  async stageInstall(slug: string): Promise<{ tempHome: string; exportDir: string }> {
    const tempHome = await mkdtemp(join(tmpdir(), "skills-hub-home-"));
    const exportDir = join(tempHome, "exported");

    await this.exec(["install", slug, "--agent", "codex", "--yes", "--dir", exportDir], {
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

  private async exec(args: string[], options?: { env?: NodeJS.ProcessEnv }) {
    try {
      const commandOptions = {
        ...options,
        env: buildSkillHubEnv(options?.env),
      };
      return await this.deps.runCommand("npx", ["-y", "@skill-hub/cli", ...args], commandOptions);
    } catch (error) {
      throw buildSkillHubError(error);
    }
  }
}

function buildSkillHubEnv(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  delete env.FORCE_COLOR;
  env.NO_COLOR = env.NO_COLOR || "1";
  return env;
}

function buildSkillHubError(error: unknown): Error {
  const message = error instanceof Error ? error.message : "Command failed";
  const stderr = getStringProperty(error, "stderr");
  const stdout = getStringProperty(error, "stdout");
  const detail = trimCommandOutput(stderr) || trimCommandOutput(stdout);
  const wrapped = new Error(detail ? `Skills Hub command failed: ${message}\n${detail}` : message);
  return Object.assign(wrapped, {
    cause: error,
    stderr,
    stdout,
  });
}

function getStringProperty(value: unknown, key: "stderr" | "stdout"): string | undefined {
  if (!value || typeof value !== "object" || !(key in value)) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

function trimCommandOutput(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) {
    return undefined;
  }
  return text.split(/\r?\n/).slice(0, 8).join("\n");
}
