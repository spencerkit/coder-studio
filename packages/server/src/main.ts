import { createServer } from "./server.js";

const server = await createServer();

async function shutdown(): Promise<void> {
  console.log("\nShutting down...");
  await server.stop();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
