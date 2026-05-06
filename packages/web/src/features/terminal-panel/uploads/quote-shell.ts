export function quoteShellSingle(input: string): string {
  return `'${input.replace(/'/g, "'\\''")}'`;
}
