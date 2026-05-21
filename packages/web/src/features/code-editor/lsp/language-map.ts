import type { LspServerKind } from "@coder-studio/core";

const TYPESCRIPT_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"]);
const PYTHON_EXTENSIONS = new Set(["py"]);
const GO_EXTENSIONS = new Set(["go"]);
const RUST_EXTENSIONS = new Set(["rs"]);

export function resolveLspServerKind(
  filePath: string,
  monacoLanguage: string
): LspServerKind | null {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";

  if (TYPESCRIPT_EXTENSIONS.has(extension) || monacoLanguage === "typescript") {
    return "typescript";
  }
  if (PYTHON_EXTENSIONS.has(extension) || monacoLanguage === "python") {
    return "python";
  }
  if (GO_EXTENSIONS.has(extension) || monacoLanguage === "go") {
    return "go";
  }
  if (RUST_EXTENSIONS.has(extension) || monacoLanguage === "rust") {
    return "rust";
  }

  return null;
}
