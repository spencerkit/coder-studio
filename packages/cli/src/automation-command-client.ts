import { callCoderStudioWsCommand } from "./automation-ws-client.js";
import { getServerStatus } from "./server-control.js";
import { getBrowserUrl } from "./server-url.js";

export interface CoderStudioCommandInput {
  apiUrl?: string;
  resolveStrategy?: "auto" | "session";
  op: string;
  args: unknown;
  timeoutMs?: number;
}

async function resolveApiUrl(
  explicitApiUrl: string | undefined,
  resolveStrategy: "auto" | "session" = "auto"
): Promise<string> {
  if (explicitApiUrl) {
    return explicitApiUrl;
  }

  const envApiUrl = process.env.CODER_STUDIO_API_URL?.trim();
  if (envApiUrl) {
    return envApiUrl;
  }

  if (resolveStrategy === "session") {
    throw new Error(
      "Session-scoped automation requires CODER_STUDIO_API_URL to be set or passed explicitly."
    );
  }

  const status = await getServerStatus();
  const browserUrl = getBrowserUrl(status);
  if (browserUrl) {
    return browserUrl;
  }

  throw new Error(
    "Unable to find a running Coder Studio server. Start it first or pass --api-url."
  );
}

export async function callCoderStudioCommand<T = unknown>(
  input: CoderStudioCommandInput
): Promise<T> {
  const apiUrl = await resolveApiUrl(input.apiUrl, input.resolveStrategy);
  return callCoderStudioWsCommand<T>({
    apiUrl,
    op: input.op,
    args: input.args,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });
}
