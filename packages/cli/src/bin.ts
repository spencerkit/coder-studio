import { main } from "./cli.js";

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("CLI error:", message);
  process.exit(1);
});
