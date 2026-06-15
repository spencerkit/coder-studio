export function detectEditorLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    py: "python",
    go: "go",
    rs: "rust",
    vue: "vue",
    java: "java",
    cpp: "cpp",
    c: "c",
    yaml: "yaml",
    yml: "yaml",
    sh: "shell",
    bash: "shell",
  };

  return langMap[ext || ""] || "plaintext";
}
