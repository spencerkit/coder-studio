import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const SKILLS_SH_BASE_URL = "https://skills.sh";
const GITHUB_API_BASE_URL = "https://api.github.com";
const MAX_SKILL_FILE_COUNT = 1_000;
const MAX_SKILL_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SKILL_TOTAL_BYTES = 50 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const REPOSITORY_STATS_TIMEOUT_MS = 3_000;
const REPOSITORY_STATS_CACHE_TTL_MS = 60 * 60 * 1_000;
const REPOSITORY_STATS_ERROR_CACHE_TTL_MS = 5 * 60 * 1_000;

type SkillsFetch = typeof globalThis.fetch;

export interface SkillsHubClientDeps {
  fetch?: SkillsFetch;
}

export interface SkillsHubSearchOptions {
  includeRepositoryStats?: boolean;
}

interface SkillsShSearchRow {
  skillId?: unknown;
  name?: unknown;
  source?: unknown;
  installs?: unknown;
}

interface RepositoryStatsCacheEntry {
  githubStars?: number;
  expiresAt: number;
}

interface SkillsShSnapshotFile {
  path: string;
  contents: string;
}

interface SkillsShSnapshot {
  files: SkillsShSnapshotFile[];
  hash: string;
}

interface SkillsShReference {
  owner: string;
  repo: string;
  skill: string;
  registryRef: string;
}

export interface SkillsShCatalogEntry {
  slug: string;
  registryRef: string;
  displayName: string;
  name?: string;
  description?: string;
  version?: string;
  installCount?: number;
  githubStars?: number;
}

export class SkillsHubClient {
  private readonly repositoryStatsCache = new Map<string, RepositoryStatsCacheEntry>();

  constructor(private readonly deps: SkillsHubClientDeps = {}) {}

  async search(
    query: string,
    options: SkillsHubSearchOptions = {}
  ): Promise<SkillsShCatalogEntry[]> {
    const url = new URL("/api/search", SKILLS_SH_BASE_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "20");
    const payload = await this.fetchJson(url);
    const rows = getRecord(payload)?.skills;
    if (!Array.isArray(rows)) {
      throw new Error("skills.sh search returned an invalid response");
    }

    const entries = rows.flatMap((value) => {
      const row = getRecord(value) as SkillsShSearchRow | undefined;
      const source = getNonEmptyString(row?.source);
      const skillId = getNonEmptyString(row?.skillId);
      if (!source || !skillId || !isValidSource(source) || !isValidReferencePart(skillId)) {
        return [];
      }

      const name = getNonEmptyString(row?.name) ?? skillId;
      const installCount = getNonNegativeInteger(row?.installs);
      return [
        {
          slug: skillId,
          registryRef: `${source}@${skillId}`,
          displayName: name,
          ...(installCount === undefined ? {} : { installCount }),
        },
      ];
    });

    if (options.includeRepositoryStats === false) {
      return entries;
    }

    const sources = [...new Set(entries.map((entry) => repositorySource(entry.registryRef)))];
    const githubStarsBySource = new Map(
      await Promise.all(
        sources.map(async (source) => [source, await this.fetchGitHubStars(source)] as const)
      )
    );

    return entries.map((entry) => {
      const githubStars = githubStarsBySource.get(repositorySource(entry.registryRef));
      return githubStars === undefined ? entry : { ...entry, githubStars };
    });
  }

  async info(slug: string, registryRef?: string): Promise<SkillsShCatalogEntry> {
    const reference = await this.resolveReference(slug, registryRef);
    const snapshot = await this.fetchSnapshot(reference);
    const metadata = parseSkillMarkdownMetadata(getSkillMarkdown(snapshot));

    return {
      slug,
      registryRef: reference.registryRef,
      displayName: metadata.name ?? slug,
      name: metadata.name ?? slug,
      description: metadata.description,
      version: snapshot.hash,
    };
  }

  async stageInstall(
    slug: string,
    registryRef?: string
  ): Promise<{ tempHome: string; exportDir: string; info: SkillsShCatalogEntry }> {
    const reference = await this.resolveReference(slug, registryRef);
    const snapshot = await this.fetchSnapshot(reference);
    const tempHome = await mkdtemp(join(tmpdir(), "skills-sh-stage-"));
    const exportDir = join(tempHome, "exported");
    const skillDir = join(exportDir, slug);

    try {
      await writeSnapshot(skillDir, snapshot);
      const metadata = parseSkillMarkdownMetadata(getSkillMarkdown(snapshot));
      return {
        tempHome,
        exportDir,
        info: {
          slug,
          registryRef: reference.registryRef,
          displayName: metadata.name ?? slug,
          name: metadata.name ?? slug,
          description: metadata.description,
          version: snapshot.hash,
        },
      };
    } catch (error) {
      await rm(tempHome, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async readStagedSkill(exportDir: string, slug: string): Promise<string> {
    return readFile(join(exportDir, slug, "SKILL.md"), "utf8");
  }

  async cleanupStage(tempHome: string): Promise<void> {
    await rm(tempHome, { recursive: true, force: true });
  }

  private async resolveReference(slug: string, registryRef?: string): Promise<SkillsShReference> {
    if (registryRef) {
      const reference = parseRegistryRef(registryRef);
      if (reference.skill !== slug) {
        throw new Error(`skills.sh reference does not match skill slug: ${slug}`);
      }
      return reference;
    }

    const rows = await this.search(slug, { includeRepositoryStats: false });
    const exact = rows.find((row) => row.slug === slug);
    if (!exact) {
      throw new Error(`Skill not found on skills.sh: ${slug}`);
    }
    return parseRegistryRef(exact.registryRef);
  }

  private async fetchSnapshot(reference: SkillsShReference): Promise<SkillsShSnapshot> {
    const url = new URL(
      `/api/download/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.repo)}/${encodeURIComponent(reference.skill)}`,
      SKILLS_SH_BASE_URL
    );
    const payload = getRecord(await this.fetchJson(url));
    if (!payload || !Array.isArray(payload.files) || !isSha256(payload.hash)) {
      throw new Error(`skills.sh returned an invalid snapshot for ${reference.registryRef}`);
    }
    if (payload.files.length === 0 || payload.files.length > MAX_SKILL_FILE_COUNT) {
      throw new Error(`skills.sh returned an invalid file count for ${reference.registryRef}`);
    }

    const files: SkillsShSnapshotFile[] = [];
    let totalBytes = 0;
    for (const value of payload.files) {
      const file = getRecord(value);
      const path = getNonEmptyString(file?.path);
      const contents = typeof file?.contents === "string" ? file.contents : undefined;
      if (!path || contents === undefined) {
        throw new Error(`skills.sh returned an invalid file for ${reference.registryRef}`);
      }
      const size = Buffer.byteLength(contents, "utf8");
      totalBytes += size;
      if (size > MAX_SKILL_FILE_BYTES || totalBytes > MAX_SKILL_TOTAL_BYTES) {
        throw new Error(`skills.sh snapshot is too large: ${reference.registryRef}`);
      }
      files.push({ path, contents });
    }

    const snapshot = { files, hash: payload.hash };
    getSkillMarkdown(snapshot);
    return snapshot;
  }

  private async fetchJson(url: URL): Promise<unknown> {
    const fetcher = this.deps.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      throw new Error(`skills.sh request failed: ${message}`, { cause: error });
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim().slice(0, 500);
      throw new Error(
        `skills.sh request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`
      );
    }

    try {
      return await response.json();
    } catch (error) {
      throw new Error("skills.sh returned invalid JSON", { cause: error });
    }
  }

  private async fetchGitHubStars(source: string): Promise<number | undefined> {
    const cached = this.repositoryStatsCache.get(source);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.githubStars;
    }

    const parts = source.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return undefined;
    }

    try {
      const url = new URL(
        `/repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`,
        GITHUB_API_BASE_URL
      );
      const headers: Record<string, string> = {
        accept: "application/vnd.github+json",
        "user-agent": "@spencer-kit/coder-studio",
        "x-github-api-version": "2022-11-28",
      };
      const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
      if (token) {
        headers.authorization = `Bearer ${token}`;
      }

      const response = await (this.deps.fetch ?? globalThis.fetch)(url, {
        headers,
        signal: AbortSignal.timeout(REPOSITORY_STATS_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`GitHub returned HTTP ${response.status}`);
      }

      const githubStars = getNonNegativeInteger(getRecord(await response.json())?.stargazers_count);
      this.repositoryStatsCache.set(source, {
        ...(githubStars === undefined ? {} : { githubStars }),
        expiresAt: Date.now() + REPOSITORY_STATS_CACHE_TTL_MS,
      });
      return githubStars;
    } catch {
      this.repositoryStatsCache.set(source, {
        expiresAt: Date.now() + REPOSITORY_STATS_ERROR_CACHE_TTL_MS,
      });
      return undefined;
    }
  }
}

function parseRegistryRef(value: string): SkillsShReference {
  const match = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)@([A-Za-z0-9_.-]+)$/);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(`Invalid skills.sh reference: ${value}`);
  }
  return {
    owner: match[1],
    repo: match[2],
    skill: match[3],
    registryRef: `${match[1]}/${match[2]}@${match[3]}`,
  };
}

function isValidSource(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 2 && parts.every(isValidReferencePart);
}

function isValidReferencePart(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.trim() || undefined;
}

function getNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function repositorySource(registryRef: string): string {
  return registryRef.slice(0, registryRef.lastIndexOf("@"));
}

function getSkillMarkdown(snapshot: SkillsShSnapshot): string {
  const file = snapshot.files.find((entry) => entry.path === "SKILL.md");
  if (!file) {
    throw new Error("skills.sh snapshot does not contain SKILL.md");
  }
  return file.contents;
}

async function writeSnapshot(skillDir: string, snapshot: SkillsShSnapshot): Promise<void> {
  const destinations = new Set<string>();
  for (const file of snapshot.files) {
    const destination = resolveSnapshotPath(skillDir, file.path);
    const key = destination.toLowerCase();
    if (destinations.has(key)) {
      throw new Error(`skills.sh snapshot contains a duplicate path: ${file.path}`);
    }
    destinations.add(key);
    await mkdir(resolve(destination, ".."), { recursive: true });
    await writeFile(destination, file.contents, "utf8");
  }
}

function resolveSnapshotPath(skillDir: string, filePath: string): string {
  if (
    filePath.includes("\\") ||
    filePath.includes("\0") ||
    filePath.startsWith("/") ||
    filePath.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`skills.sh snapshot contains an unsafe path: ${filePath}`);
  }

  const destination = resolve(skillDir, ...filePath.split("/"));
  const relativePath = relative(skillDir, destination);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`skills.sh snapshot contains an unsafe path: ${filePath}`);
  }
  return destination;
}

function parseSkillMarkdownMetadata(markdown: string): {
  name?: string;
  description?: string;
} {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match?.[1]) {
    return {};
  }

  const metadata: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair?.[1] || pair[2] === undefined) {
      continue;
    }
    const value = parseYamlScalar(pair[2].trim());
    if (!value) {
      continue;
    }
    if (pair[1] === "name") {
      metadata.name = value;
    } else if (pair[1] === "description") {
      metadata.description = value;
    }
  }
  return metadata;
}

function parseYamlScalar(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === "string" ? parsed : value.slice(1, -1);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}
