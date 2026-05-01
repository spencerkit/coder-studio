import type { TerminalMeta } from '../atoms';

export function formatTerminalTitle(meta: TerminalMeta | null | undefined, index: number, fallback: string) {
  const rawTitle = meta?.title?.trim();
  const shellLabel = inferShellLabel(rawTitle);

  if (!rawTitle || isGenericShellTitle(rawTitle, fallback)) {
    return `${shellLabel ?? fallback} — ${index + 1}`;
  }

  if (shellLabel) {
    return `${shellLabel} — ${index + 1}`;
  }

  return rawTitle;
}

function inferShellLabel(rawTitle?: string) {
  if (!rawTitle) {
    return null;
  }

  const candidate = rawTitle.split(/[\\/]/).pop()?.trim();
  if (!candidate) {
    return null;
  }

  const normalized = candidate.toLowerCase().replace(/\.exe$/, '');
  const knownShells = new Set([
    'bash',
    'cmd',
    'csh',
    'fish',
    'ksh',
    'powershell',
    'pwsh',
    'sh',
    'tcsh',
    'zsh',
  ]);

  if (!knownShells.has(normalized)) {
    return null;
  }

  return normalized;
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
