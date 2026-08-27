import type {
  SkillRecommendationEntry,
  SkillRecommendationPage,
  WorkspaceIntelligenceSummary,
} from "@coder-studio/core";

export interface SkillRecommendationSearchResult {
  slug: string;
  registryRef?: string;
  displayName: string;
  description?: string;
}

interface RecommendationQuerySeed {
  query: string;
  reason: string;
  weight: number;
}

interface RecommendationAccumulator {
  slug: string;
  registryRef?: string;
  displayName: string;
  description?: string;
  score: number;
  reasons: string[];
  sourceQuery: string;
  sourceQueryScore: number;
}

const DEFAULT_RECOMMENDATION_LIMIT = 20;

export async function buildSkillRecommendationEntries(input: {
  intelligence: WorkspaceIntelligenceSummary;
  search: (query: string) => Promise<SkillRecommendationSearchResult[]>;
  isInstalled: (slug: string) => boolean;
}): Promise<SkillRecommendationEntry[]> {
  const seeds = buildRecommendationQueries(input.intelligence);
  if (seeds.length === 0) {
    return [];
  }

  const recommendations = new Map<string, RecommendationAccumulator>();

  await Promise.all(
    seeds.map(async (seed) => {
      const results = await input.search(seed.query).catch(() => []);

      results.forEach((result, index) => {
        if (input.isInstalled(result.slug)) {
          return;
        }

        const queryScore =
          seed.weight + Math.max(0, 12 - index) + scoreCandidate(result, seed.query);
        const recommendationKey = result.registryRef ?? result.slug;
        const current = recommendations.get(recommendationKey) ?? {
          slug: result.slug,
          registryRef: result.registryRef,
          displayName: result.displayName,
          description: result.description,
          score: 0,
          reasons: [],
          sourceQuery: seed.query,
          sourceQueryScore: 0,
        };

        current.displayName = result.displayName;
        if (result.description) {
          current.description = result.description;
        }
        current.score += queryScore;
        if (!current.reasons.includes(seed.reason)) {
          current.reasons.push(seed.reason);
        }
        if (
          queryScore > current.sourceQueryScore ||
          (queryScore === current.sourceQueryScore &&
            seed.query.length < current.sourceQuery.length)
        ) {
          current.sourceQuery = seed.query;
          current.sourceQueryScore = queryScore;
        }

        recommendations.set(recommendationKey, current);
      });
    })
  );

  return Array.from(recommendations.values())
    .sort((left, right) => {
      return (
        right.score - left.score ||
        left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }) ||
        left.slug.localeCompare(right.slug, undefined, { sensitivity: "base" })
      );
    })
    .map((entry) => ({
      slug: entry.slug,
      ...(entry.registryRef ? { registryRef: entry.registryRef } : {}),
      displayName: entry.displayName,
      description: entry.description,
      reason: entry.reasons.join("; "),
      sourceQuery: entry.sourceQuery,
      score: entry.score,
      installed: false,
    }));
}

export async function buildSkillRecommendations(input: {
  intelligence: WorkspaceIntelligenceSummary;
  search: (query: string) => Promise<SkillRecommendationSearchResult[]>;
  isInstalled: (slug: string) => boolean;
  limit?: number;
  offset?: number;
}): Promise<SkillRecommendationPage> {
  const entries = await buildSkillRecommendationEntries(input);
  const offset = input.offset ?? 0;
  const limit = input.limit ?? DEFAULT_RECOMMENDATION_LIMIT;
  const pageEntries = entries.slice(offset, offset + limit);

  return {
    entries: pageEntries,
    hasMore: offset + pageEntries.length < entries.length,
  };
}

function buildRecommendationQueries(
  summary: WorkspaceIntelligenceSummary
): RecommendationQuerySeed[] {
  const seeds: RecommendationQuerySeed[] = [];

  const frameworks = uniqueValues(summary.frameworks).slice(0, 3);
  if (frameworks.length > 0) {
    seeds.push({
      query: frameworks.join(" "),
      reason: `Matches the ${formatList(frameworks)} stack`,
      weight: 40,
    });
  }

  const verificationTerms = deriveVerificationTerms(summary);
  if (verificationTerms.length > 0) {
    seeds.push({
      query: verificationTerms.join(" "),
      reason: "Matches the test, build, and lint workflow",
      weight: 30,
    });
  }

  const layoutTerms = deriveLayoutTerms(summary);
  if (layoutTerms.length > 0) {
    seeds.push({
      query: layoutTerms.join(" "),
      reason: "Matches the workspace package and directory layout",
      weight: 20,
    });
  }

  const workspaceTerms = deriveWorkspaceTerms(summary);
  if (workspaceTerms.length > 0) {
    seeds.push({
      query: workspaceTerms.join(" "),
      reason: workspaceReason(summary),
      weight: 10,
    });
  }

  return uniqueQueries(seeds);
}

function deriveVerificationTerms(summary: WorkspaceIntelligenceSummary): string[] {
  const terms = new Set<string>();
  const commands = summary.verificationCommands ?? [];

  if (summary.scripts.test || commands.some((entry) => /test/i.test(entry.command))) {
    terms.add("test");
  }
  if (summary.scripts.build || commands.some((entry) => /build/i.test(entry.command))) {
    terms.add("build");
  }
  if (summary.scripts.lint || commands.some((entry) => /lint/i.test(entry.command))) {
    terms.add("lint");
  }
  if (
    commands.some(
      (entry) => /verify|check|ci/i.test(entry.command) || /verify|check/i.test(entry.reason)
    )
  ) {
    terms.add("verify");
  }

  return Array.from(terms);
}

function deriveLayoutTerms(summary: WorkspaceIntelligenceSummary): string[] {
  const terms = new Set<string>();

  for (const pkg of summary.packages ?? []) {
    switch (pkg.role) {
      case "frontend_ui":
        terms.add("frontend");
        terms.add("ui");
        break;
      case "backend_runtime":
        terms.add("backend");
        terms.add("runtime");
        break;
      case "provider_integrations":
        terms.add("provider");
        terms.add("integrations");
        break;
      case "shared_contracts":
        terms.add("shared");
        terms.add("contracts");
        break;
      case "cli_entrypoint":
        terms.add("cli");
        terms.add("entrypoint");
        break;
      case "shared_utilities":
        terms.add("shared");
        terms.add("utilities");
        break;
      case "shared_package":
        terms.add("shared");
        break;
    }
  }

  for (const directory of summary.keyDirectories ?? []) {
    switch (directory.kind) {
      case "frontend":
        terms.add("frontend");
        break;
      case "backend":
        terms.add("backend");
        break;
      case "providers":
        terms.add("provider");
        break;
      case "shared":
        terms.add("shared");
        break;
      case "cli":
        terms.add("cli");
        break;
      case "docs":
        terms.add("docs");
        break;
      case "tests":
        terms.add("tests");
        break;
      case "scripts":
        terms.add("scripts");
        break;
      case "other":
        break;
    }
  }

  return Array.from(terms).slice(0, 6);
}

function deriveWorkspaceTerms(summary: WorkspaceIntelligenceSummary): string[] {
  const terms = new Set<string>();

  if (summary.workspaceKind === "monorepo") {
    terms.add("monorepo");
  } else if (summary.workspaceKind === "node_app") {
    terms.add("node");
    terms.add("app");
  }

  if (summary.packageManager) {
    terms.add(summary.packageManager);
  }

  return Array.from(terms);
}

function workspaceReason(summary: WorkspaceIntelligenceSummary): string {
  if (summary.workspaceKind === "monorepo" && summary.packageManager) {
    return `Matches a ${summary.packageManager} monorepo`;
  }

  if (summary.workspaceKind === "monorepo") {
    return "Matches a monorepo workspace";
  }

  if (summary.packageManager) {
    return `Matches the ${summary.packageManager} workspace setup`;
  }

  return "Matches the workspace setup";
}

function scoreCandidate(candidate: SkillRecommendationSearchResult, query: string): number {
  const haystack = new Set(
    tokenize(`${candidate.slug} ${candidate.displayName} ${candidate.description ?? ""}`)
  );
  let score = 0;

  for (const token of tokenize(query)) {
    if (haystack.has(token)) {
      score += 2;
    }
  }

  return score;
}

function uniqueQueries(seeds: RecommendationQuerySeed[]): RecommendationQuerySeed[] {
  const seen = new Set<string>();
  const uniqueSeeds: RecommendationQuerySeed[] = [];

  for (const seed of seeds) {
    const key = normalize(seed.query);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueSeeds.push(seed);
  }

  return uniqueSeeds;
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function formatList(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9.+#-]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}
