function slugifyBranchName(branch: string) {
  return branch
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildSuggestedWorktreePath(workspacePath: string, branch: string) {
  const raw = workspacePath.trim();
  const normalized = raw.replace(/[\\/]+$/, "") || raw;
  const separator = raw.includes("\\") ? "\\" : "/";
  const driveRootMatch = /^([A-Za-z]:)([\\/]*)(.*)$/.exec(raw);
  const uncRootMatch = /^(\\\\|\/\/)([^\\/]+)[\\/]+([^\\/]+)(?:[\\/]+(.*))?$/.exec(raw);
  let prefix = "";
  let rest = normalized;

  if (driveRootMatch) {
    prefix = `${driveRootMatch[1]}${separator}`;
    rest = driveRootMatch[3].replace(/[\\/]+$/, "").replace(/^[\\/]+/, "");
  } else if (uncRootMatch) {
    prefix = `${uncRootMatch[1]}${uncRootMatch[2]}${separator}${uncRootMatch[3]}${separator}`;
    rest = (uncRootMatch[4] ?? "").replace(/[\\/]+$/, "").replace(/^[\\/]+/, "");
  } else if (normalized.startsWith("/") || normalized.startsWith("\\")) {
    prefix = normalized[0];
    rest = normalized.replace(/^[\\/]+/, "");
  }

  const parts = rest.split(/[\\/]+/).filter(Boolean);
  const base = parts.pop() ?? "worktree";
  const parent = parts.length > 0 ? `${parts.join(separator)}${separator}` : "";
  const suffix = slugifyBranchName(branch || "worktree");
  return `${prefix}${parent}${base}-${suffix}`;
}

export function normalizeWorktreePathInput(path: string) {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }

  if (/^[A-Za-z]:[\\/]+$/.test(trimmed)) {
    return `${trimmed.slice(0, 2)}${trimmed.includes("\\") ? "\\" : "/"}`;
  }

  const normalized = trimmed.replace(/[\\/]+$/, "");
  return normalized || trimmed;
}

export function isAbsoluteWorktreePath(path: string) {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\|\/\/)/.test(path);
}

interface ParsedAbsolutePath {
  root: string;
  separator: "/" | "\\";
  segments: string[];
}

function normalizeSegments(value: string) {
  return value
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function parseAbsolutePath(rawPath: string): ParsedAbsolutePath | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }

  const driveRootMatch = /^([A-Za-z]:)([\\/]*)(.*)$/.exec(trimmed);
  if (driveRootMatch) {
    const separator = trimmed.includes("\\") ? "\\" : "/";
    const root = `${driveRootMatch[1]}${separator}`;
    const rest = driveRootMatch[3].replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
    return {
      root,
      separator,
      segments: normalizeSegments(rest),
    };
  }

  const uncRootMatch = /^(\\\\|\/\/)([^\\/]+)[\\/]+([^\\/]+)(?:[\\/]+(.*))?$/.exec(trimmed);
  if (uncRootMatch) {
    const separator = uncRootMatch[1] === "\\\\" ? "\\" : "/";
    const root = `${uncRootMatch[1]}${uncRootMatch[2]}${separator}${uncRootMatch[3]}${separator}`;
    const rest = (uncRootMatch[4] ?? "").replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
    return {
      root,
      separator,
      segments: normalizeSegments(rest),
    };
  }

  if (trimmed.startsWith("/")) {
    const rest = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
    return {
      root: "/",
      separator: "/",
      segments: normalizeSegments(rest),
    };
  }

  return null;
}

function composeAbsolutePath(parsed: ParsedAbsolutePath) {
  if (parsed.root === "/") {
    return parsed.segments.length > 0 ? `/${parsed.segments.join("/")}` : "/";
  }

  return parsed.segments.length > 0
    ? `${parsed.root}${parsed.segments.join(parsed.separator)}`
    : parsed.root;
}

export function getAbsolutePathParent(path: string) {
  const parsed = parseAbsolutePath(path);
  if (!parsed || parsed.segments.length === 0) {
    return null;
  }

  return composeAbsolutePath({
    ...parsed,
    segments: parsed.segments.slice(0, -1),
  });
}

export function getAbsolutePathName(path: string) {
  const parsed = parseAbsolutePath(path);
  return parsed?.segments.at(-1) ?? "";
}

export function joinAbsoluteChildPath(parentPath: string, childName: string) {
  const parsed = parseAbsolutePath(parentPath);
  if (!parsed) {
    return childName;
  }

  return composeAbsolutePath({
    ...parsed,
    segments: [...parsed.segments, childName],
  });
}
