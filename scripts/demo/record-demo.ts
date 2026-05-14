import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

const OUTPUT_DIR = join(process.cwd(), "docs", "assets");
const OUTPUT_VIDEO = join(OUTPUT_DIR, "demo.mp4");
const OUTPUT_POSTER = join(OUTPUT_DIR, "demo-poster.png");
const BASE_URL = process.env.DEMO_BASE_URL ?? "http://127.0.0.1:5173";

const SCENES = [
  "ui-preview.html?scene=workspace-desktop&theme=mint-dark&locale=en&device=desktop",
  "ui-preview.html?scene=command-palette&theme=mint-dark&locale=en&device=desktop",
  "ui-preview.html?scene=workspace-launch-modal&theme=mint-dark&locale=en&device=desktop",
  "ui-preview.html?scene=workspace-mobile&theme=mint-dark&locale=en&device=mobile",
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? -1}`));
    });
  });
}

async function waitForUrl(page: Page, url: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 5_000 });
      if (response?.ok()) {
        await page.waitForLoadState("networkidle");
        return;
      }
    } catch {}
    await sleep(500);
  }

  throw new Error(`Unable to reach ${url}`);
}

async function cleanupOldArtifacts(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await rm(OUTPUT_VIDEO, { force: true });
  await rm(OUTPUT_POSTER, { force: true });

  const files = await readdir(OUTPUT_DIR);
  await Promise.all(
    files
      .filter((file) => file.endsWith(".webm"))
      .map((file) => rm(join(OUTPUT_DIR, file), { force: true }))
  );
}

async function captureScene(page: Page, scenePath: string, index: number): Promise<void> {
  const url = `${BASE_URL}/${scenePath}`;
  await waitForUrl(page, url);
  await sleep(1200);

  if (index === 0) {
    await page.screenshot({ path: OUTPUT_POSTER, fullPage: false });
  }

  if (scenePath.includes("workspace-desktop")) {
    await page.mouse.move(180, 150);
    await sleep(500);
    await page.mouse.move(620, 310, { steps: 12 });
    await sleep(1500);
    return;
  }

  if (scenePath.includes("command-palette")) {
    await page.mouse.move(610, 240);
    await sleep(500);
    await page.keyboard.press("ArrowDown");
    await sleep(400);
    await page.keyboard.press("ArrowDown");
    await sleep(1200);
    return;
  }

  if (scenePath.includes("workspace-launch-modal")) {
    await page.mouse.move(530, 410);
    await sleep(500);
    await page.mouse.wheel(0, 320);
    await sleep(1200);
    return;
  }

  if (scenePath.includes("workspace-mobile")) {
    await page.mouse.move(250, 720);
    await sleep(600);
    await page.mouse.move(250, 120, { steps: 18 });
    await sleep(1200);
  }
}

async function record(): Promise<string> {
  await cleanupOldArtifacts();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: OUTPUT_DIR,
      size: { width: 1440, height: 900 },
    },
  });
  const page = await context.newPage();

  for (const [index, scenePath] of SCENES.entries()) {
    await captureScene(page, scenePath, index);
  }

  const video = page.video();
  await context.close();
  await browser.close();

  const recordedPath = await video?.path();
  if (!recordedPath || !(await pathExists(recordedPath))) {
    throw new Error("Playwright did not produce a video file");
  }

  return recordedPath;
}

async function transcodeToMp4(inputPath: string): Promise<void> {
  const tempPath = join(OUTPUT_DIR, "demo-source.webm");
  if (inputPath !== tempPath) {
    await rename(inputPath, tempPath);
  }

  await runCommand("ffmpeg", [
    "-y",
    "-i",
    tempPath,
    "-vf",
    "scale=1280:-2",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    OUTPUT_VIDEO,
  ]);

  await rm(tempPath, { force: true });
}

async function main(): Promise<void> {
  const recordedPath = await record();
  await transcodeToMp4(recordedPath);
  console.log(`Saved video to ${OUTPUT_VIDEO}`);
  console.log(`Saved poster to ${OUTPUT_POSTER}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
