export interface ParsedSkillSearchRow {
  slug: string;
  displayName: string;
  description?: string;
}

export function parseSkillsHubSearchOutput(output: string): ParsedSkillSearchRow[] {
  const lines = output.split(/\r?\n/);
  const rows: ParsedSkillSearchRow[] = [];
  let current: ParsedSkillSearchRow | null = null;

  for (const line of lines) {
    const cleanLine = stripAnsi(line).trimEnd();
    const slugMatch = cleanLine.match(
      /^\s*(?:\d+\.\s+|\[(?:--|\d+)\]\s+)?([a-z0-9][a-z0-9-]*)(?:\s+v[^\s]+)?\s*$/i
    );
    if (slugMatch) {
      if (current) rows.push(current);
      current = { slug: slugMatch[1]!, displayName: slugMatch[1]! };
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

function stripAnsi(value: string): string {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;]*m/g,
    ""
  );
}
