import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function getCoderStudioHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CODER_STUDIO_HOME?.trim();
  if (!override) return join(homedir(), ".coder-studio");
  return resolve(override);
}
