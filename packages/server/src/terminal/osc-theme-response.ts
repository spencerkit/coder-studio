/**
 * OSC 11 (terminal background color) query detection and response helpers.
 *
 * TUIs such as Gemini CLI detect light/dark intent by writing `\x1b]11;?\x1b\\`
 * to stdout and reading the RGB response on stdin. On Windows, ConPTY intercepts
 * this round trip before xterm.js can answer, so the server injects the response
 * directly into the PTY using the frontend theme background forwarded at spawn.
 */

/** Matches `\x1b]11;?\x1b\\` and `\x1b]11;?\x07` (BEL-terminated). */
export const OSC_11_BACKGROUND_QUERY = /\x1b\]11;\?(?:\x1b\\|\x07)/;

function parseHexColor(input: string): { r: number; g: number; b: number } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("#")) {
    return null;
  }

  const hex = trimmed.slice(1);
  let r: number;
  let g: number;
  let b: number;
  if (hex.length === 3) {
    r = Number.parseInt(hex[0]! + hex[0]!, 16);
    g = Number.parseInt(hex[1]! + hex[1]!, 16);
    b = Number.parseInt(hex[2]! + hex[2]!, 16);
  } else if (hex.length === 6 || hex.length === 8) {
    r = Number.parseInt(hex.slice(0, 2), 16);
    g = Number.parseInt(hex.slice(2, 4), 16);
    b = Number.parseInt(hex.slice(4, 6), 16);
  } else {
    return null;
  }

  if ([r, g, b].some((v) => Number.isNaN(v))) {
    return null;
  }
  return { r, g, b };
}

/**
 * Format an OSC 11 background-color response using X11 rgb:RRRR/GGGG/BBBB notation,
 * matching the encoding used by the frontend xterm-host OSC handlers.
 */
export function formatOsc11BackgroundResponse(background: string): string | null {
  const rgb = parseHexColor(background);
  if (!rgb) {
    return null;
  }

  const encodeChannel = (channel: number) => channel.toString(16).padStart(2, "0").repeat(2);
  return `\x1b]11;rgb:${encodeChannel(rgb.r)}/${encodeChannel(rgb.g)}/${encodeChannel(rgb.b)}\x1b\\`;
}

export function containsOsc11BackgroundQuery(data: string): boolean {
  return OSC_11_BACKGROUND_QUERY.test(data);
}

export function shouldInjectOsc11BackgroundResponse(
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === "win32";
}
