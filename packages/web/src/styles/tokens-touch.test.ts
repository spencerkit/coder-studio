import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(`${process.cwd()}/src/styles/tokens.css`, 'utf8');

function getRuleBlock(selector: string): string {
  let block = '';
  const matcher = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null = null;

  while ((match = matcher.exec(stylesheet)) !== null) {
    const currentSelector = match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();

    if (currentSelector === selector) {
      block = match[2];
    }
  }

  return block;
}

describe('tokens.css touch tokens', () => {
  it('defines desktop-default touch target tokens on :root', () => {
    const root = getRuleBlock(':root');

    expect(root).toContain('--touch-target-min: 32px');
    expect(root).toContain('--touch-target-comfortable: 40px');
    expect(root).toContain('--touch-target-large: 44px');
    expect(root).toContain('--touch-spacing-min: 8px');
    expect(root).toContain('--touch-hit-slop: 0px');
  });

  it('overrides touch tokens on narrow viewport OR coarse pointer', () => {
    const mediaMatch =
      /@media\s*\(max-width:\s*899px\)\s*,\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\}\s*\}/m.exec(stylesheet);

    expect(mediaMatch, 'expected @media (max-width: 899px), (pointer: coarse) block').not.toBeNull();

    const body = mediaMatch![1];

    expect(body).toContain('--touch-target-min: 44px');
    expect(body).toContain('--touch-target-comfortable: 48px');
    expect(body).toContain('--touch-target-large: 56px');
    expect(body).toContain('--touch-spacing-min: 12px');
    expect(body).toContain('--touch-hit-slop: 8px');
  });
});
