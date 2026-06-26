export type TerminalProfileSource = "detected" | "custom";
export type TerminalProfileRuntime = "native" | "wsl";

export interface TerminalProfile {
  id: string;
  label: string;
  source: TerminalProfileSource;
  runtime: TerminalProfileRuntime;
  icon: string;
}

export interface CustomTerminalProfile {
  id: `custom:${string}`;
  label: string;
  command: string;
  args?: string[];
  icon?: string;
}

export interface TerminalProfilesListResult {
  profiles: TerminalProfile[];
  configuredDefaultProfileId?: string;
  resolvedDefaultProfileId: string | null;
}
