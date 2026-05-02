import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export function isInteractiveSession(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

export async function confirmYesNo(prompt: string): Promise<boolean> {
  const rl = createInterface({ input, output });

  try {
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
