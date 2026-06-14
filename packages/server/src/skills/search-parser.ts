export interface ParsedSkillSearchRow {
  slug: string;
  displayName: string;
  description?: string;
  version?: string;
}

export function parseSkillsHubSearchOutput(output: string): ParsedSkillSearchRow[] {
  const jsonRows = parseJsonSearchOutput(output);
  if (jsonRows) {
    return jsonRows;
  }

  const lines = output.split(/\r?\n/);
  const rows: ParsedSkillSearchRow[] = [];
  let current: ParsedSkillSearchRow | null = null;

  for (const line of lines) {
    const cleanLine = stripAnsi(line).trimEnd();
    const slugMatch = cleanLine.match(
      /^\s*(?:\d+\.\s+|\[(?:--|\d+)\]\s+)?([a-z0-9][a-z0-9-]*)(?:\s+v([^\s]+))?\s*$/i
    );
    if (slugMatch) {
      if (current) rows.push(current);
      current = {
        slug: slugMatch[1]!,
        displayName: slugMatch[1]!,
        ...definedField("version", cleanVersion(slugMatch[2])),
      };
      continue;
    }

    if (!current) continue;

    const nameMatch = cleanLine.match(/^\s*Name:\s+(.+)$/);
    if (nameMatch) current.displayName = nameMatch[1]!.trim();

    const descriptionMatch = cleanLine.match(/^\s*Description:\s+(.+)$/);
    if (descriptionMatch) {
      current.description = descriptionMatch[1]!.trim();
      continue;
    }

    if (
      !current.description &&
      /^\s{2,}\S/.test(line) &&
      !/^\s*(?:npx|npm|pnpm|yarn)\b/i.test(cleanLine)
    ) {
      current.description = cleanLine.trim();
    }
  }

  if (current) rows.push(current);
  return rows;
}

function parseJsonSearchOutput(output: string): ParsedSkillSearchRow[] | undefined {
  const cleanOutput = stripAnsi(output).trim();
  const start = cleanOutput.indexOf("[");
  const end = cleanOutput.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(cleanOutput.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }

    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const row = item as {
        slug?: unknown;
        name?: unknown;
        description?: unknown;
        version?: unknown;
      };
      if (typeof row.slug !== "string" || row.slug.trim().length === 0) {
        return [];
      }

      const slug = row.slug.trim();
      const name = typeof row.name === "string" ? row.name.trim() : "";
      const description = typeof row.description === "string" ? row.description.trim() : "";
      const version = typeof row.version === "string" ? cleanVersion(row.version) : undefined;

      return [
        {
          slug,
          displayName: name || slug,
          description: description || undefined,
          ...definedField("version", version),
        },
      ];
    });
  } catch {
    return undefined;
  }
}

function definedField<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function cleanVersion(value: string | undefined): string | undefined {
  const version = value?.trim().replace(/^v(?=\d)/i, "");
  return version || undefined;
}

function stripAnsi(value: string): string {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;]*m/g,
    ""
  );
}
