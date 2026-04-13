import type { ExecTarget } from "../../state/workbench";
import { invokeRpc } from "./client";

export type ProviderHooksInstallResponse = {
  provider: string;
  status: "installed";
};

const assertWorkspaceContext = (cwd: string) => {
  if (!cwd.trim()) {
    throw new Error("Select an active workspace before injecting hooks.");
  }
};

export const installProviderHooks = async (
  provider: string,
  cwd: string,
  target: ExecTarget,
): Promise<ProviderHooksInstallResponse> => {
  assertWorkspaceContext(cwd);
  return invokeRpc<ProviderHooksInstallResponse>("provider_hooks_install", { provider, cwd, target });
};
