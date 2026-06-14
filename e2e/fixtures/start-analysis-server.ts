import { createServer } from "../../packages/server/src/server.ts";
import { WorkAnalysisService } from "../../packages/server/src/work-analysis/service.ts";

WorkAnalysisService.prototype.startAutoScan = function startAutoScanForE2E() {
  // Keep the seeded hourly index stable for analysis acceptance.
};

const server = await createServer();

process.on("SIGINT", async () => {
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.stop();
  process.exit(0);
});
