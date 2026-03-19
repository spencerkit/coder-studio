export const fuzzyFileScore = (query: string, target: string) => {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedTarget = target.toLowerCase();
  if (!normalizedQuery) return 0;
  if (normalizedTarget === normalizedQuery) return 1000;
  if (normalizedTarget.includes(normalizedQuery)) {
    return 700 - Math.max(0, normalizedTarget.indexOf(normalizedQuery));
  }

  let score = 0;
  let cursor = 0;
  for (const char of normalizedQuery) {
    const index = normalizedTarget.indexOf(char, cursor);
    if (index === -1) return -1;
    score += index === cursor ? 10 : Math.max(2, 8 - (index - cursor));
    cursor = index + 1;
  }
  return score;
};

export const inferEditorLanguage = (path: string) => {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "css":
    case "scss":
      return "css";
    case "html":
    case "htm":
      return "html";
    default:
      return "plaintext";
  }
};
