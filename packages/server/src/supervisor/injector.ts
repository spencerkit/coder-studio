import { createHash } from "node:crypto";
import {
  DEFAULT_SUPERVISOR_CONFIG,
  type SessionState,
  type Supervisor,
  type SupervisorConfig,
  type SupervisorCycle,
} from "@coder-studio/core";
import type { SessionManager } from "../session/manager.js";
import type { TerminalManager } from "../terminal/manager.js";

export const INJECTABLE_SESSION_STATES: ReadonlySet<SessionState> = new Set<SessionState>([
  "idle",
  "running",
]);

/**
 * Explain why a given session state cannot accept injection. Returned
 * messages are user-facing: they should describe the lifecycle phase in
 * terms the operator can act on (e.g. wait for the CLI to finish booting,
 * resume the session, etc.).
 */
export function describeNonInjectableState(state: SessionState): string {
  switch (state) {
    case "starting":
      return "session is still starting up (provider CLI has not completed its first turn yet)";
    case "ended":
      return "session has already ended";
    case "draft":
      return "session is still a draft and has no terminal attached";
    default:
      return `session state "${state}" does not accept injection`;
  }
}

export class SupervisorInjector {
  private readonly config: SupervisorConfig;

  constructor(
    readonly deps: {
      sessionMgr: SessionManager;
      terminalMgr: TerminalManager;
      config?: SupervisorConfig;
    }
  ) {
    this.config = deps.config ?? DEFAULT_SUPERVISOR_CONFIG;
  }

  async inject(
    supervisor: Supervisor,
    input: { message: string },
    recentCycles: SupervisorCycle[]
  ): Promise<{ injected: boolean; text: string }> {
    const session = this.deps.sessionMgr.get(supervisor.sessionId);
    if (!session) {
      throw {
        code: "inject_target_unavailable",
        message: `Session ${supervisor.sessionId} is not available for injection`,
      };
    }
    if (!INJECTABLE_SESSION_STATES.has(session.state)) {
      throw {
        code: "inject_target_unavailable",
        message: `Cannot inject into session ${supervisor.sessionId}: ${describeNonInjectableState(session.state)}`,
      };
    }

    const message = input.message.slice(0, this.config.guidanceMaxChars);
    const text = `[Supervisor] ${message}`;

    const hash = createHash("sha1").update(text).digest("hex");
    const duplicate = recentCycles
      .slice(0, this.config.guidanceDedupeWindow)
      .map((cycle) => cycle.injectedGuidance)
      .filter((value): value is string => Boolean(value))
      .some((value) => createHash("sha1").update(value).digest("hex") === hash);

    if (duplicate) {
      return { injected: false, text };
    }

    // Wrap with bracketed-paste so the TUI doesn't interpret any embedded
    // characters as slash-commands / keybindings. Terminate with \r so the
    // receiving CLI actually submits the message.
    const BRACKETED_PASTE_START = "\x1b[200~";
    const BRACKETED_PASTE_END = "\x1b[201~";
    const SUBMIT = "\r";
    const payload = `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}${SUBMIT}`;

    this.deps.sessionMgr.sendInput(session.id, Buffer.from(payload, "utf8"), "internal_submit");
    return { injected: true, text };
  }
}
