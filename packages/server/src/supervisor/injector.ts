import type { TerminalManager } from '../terminal/manager.js';

export async function injectGuidance(
  terminalMgr: TerminalManager,
  sessionId: string,
  guidance: string
): Promise<void> {
  const formattedGuidance = `\n[Supervisor] ${guidance}\n`;
  terminalMgr.writeToSession(sessionId, formattedGuidance);
}