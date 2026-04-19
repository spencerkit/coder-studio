import type { TerminalMeta } from '../../../atoms/terminals';

export function formatTerminalTitle(meta: TerminalMeta | null | undefined, index: number, fallback: string) {
  const rawTitle = meta?.title?.trim();

  if (!rawTitle || isGenericShellTitle(rawTitle, fallback)) {
    return `bash — ${index + 1}`;
  }

  if (rawTitle === '/bin/bash' || rawTitle === 'bash') {
    return `bash — ${index + 1}`;
  }

  return rawTitle;
}

function isGenericShellTitle(rawTitle: string, fallback: string) {
  const normalizedTitle = rawTitle.toLowerCase();
  const normalizedFallback = fallback.trim().toLowerCase();

  return (
    normalizedTitle === normalizedFallback ||
    normalizedTitle === 'shell terminal' ||
    normalizedTitle === 'shell 终端'
  );
}
