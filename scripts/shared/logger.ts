/**
 * Logger utilities for build scripts
 */

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
} as const;

type Color = keyof typeof COLORS;

function colorize(text: string, color: Color): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

export function log(message: string): void {
  console.log(message);
}

export function info(message: string): void {
  console.log(colorize("ℹ", "blue"), message);
}

export function success(message: string): void {
  console.log(colorize("✓", "green"), message);
}

export function warn(message: string): void {
  console.log(colorize("⚠", "yellow"), message);
}

export function error(message: string): void {
  console.error(colorize("✗", "red"), message);
}

export function step(stepName: string, message: string): void {
  console.log(colorize(`\n[${stepName}]`, "bright"), message);
}
