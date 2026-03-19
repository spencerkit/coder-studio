export type DiffStats = {
  files: number;
  additions: number;
  deletions: number;
  diffFiles: string[];
};

export const computeDiffStats = (diff: string): DiffStats => {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  const diffFiles: string[] = [];
  diff.split("\n").forEach((line) => {
    if (line.startsWith("diff --git")) {
      files += 1;
      const parts = line.split(" ");
      const file = parts[2]?.replace("a/", "") ?? "file";
      diffFiles.push(file);
      return;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      return;
    }
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  });
  return { files, additions, deletions, diffFiles };
};
