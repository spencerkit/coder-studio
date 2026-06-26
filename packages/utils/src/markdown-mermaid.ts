const MERMAID_FENCE_PATTERN = /^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*mermaid(?:[ \t].*)?$/m;

export function markdownUsesMermaid(markdown: string): boolean {
  return MERMAID_FENCE_PATTERN.test(markdown);
}
