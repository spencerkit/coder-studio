import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { basename, extname, resolve } from "node:path";
import { error, info, ROOT_DIR, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

const DEFAULT_DIRECTORY = resolve(ROOT_DIR, "release/wsl-acceptance/downloads");
const DEFAULT_PORT = 8787;

export interface ServeWslAcceptanceOptions {
  directory: string;
  port: number;
}

function readValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export function parseServeWslAcceptanceArgs(argv: string[]): ServeWslAcceptanceOptions {
  const options: ServeWslAcceptanceOptions = {
    directory: DEFAULT_DIRECTORY,
    port: DEFAULT_PORT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--":
        break;
      case "--directory":
        options.directory = resolve(readValue(argv, ++index, "--directory"));
        break;
      case "--port": {
        const port = Number(readValue(argv, ++index, "--port"));
        if (!Number.isInteger(port) || port < 1 || port > 65_535) {
          throw new Error("--port must be an integer between 1 and 65535");
        }
        options.port = port;
        break;
      }
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown WSL acceptance server option: ${argument}`);
    }
  }
  return options;
}

function printUsage(): void {
  console.log(`Serve the prepared WSL acceptance download channel on loopback.

Usage:
  pnpm acceptance:wsl:serve -- [--port 8787] [--directory <path>]`);
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".json":
      return "application/json; charset=utf-8";
    case ".tgz":
    case ".gz":
      return "application/gzip";
    default:
      return "application/octet-stream";
  }
}

function safeFilename(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const value = decoded.replace(/^\/+/, "");
  if (!value || value !== basename(value) || value === "." || value === "..") return null;
  return value;
}

export async function startWslAcceptanceServer(
  options: ServeWslAcceptanceOptions
): Promise<{ server: Server; url: string; files: string[] }> {
  const root = resolve(options.directory);
  const files = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  if (!files.some((file) => file.startsWith("coder-studio-engine-linux-"))) {
    throw new Error(`No prepared WSL acceptance artifacts were found under ${root}`);
  }

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    if (requestUrl.pathname === "/") {
      const body = Buffer.from(`${JSON.stringify({ files }, null, 2)}\n`, "utf8");
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": body.byteLength,
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }
    const filename = safeFilename(requestUrl.pathname);
    if (!filename || !files.includes(filename)) {
      response.writeHead(404, { "Cache-Control": "no-store" }).end();
      return;
    }
    const path = resolve(root, filename);
    try {
      const metadata = await stat(path);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": contentType(path),
        "Content-Length": metadata.size,
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(path).pipe(response);
      info(`${request.method} /${filename}`);
    } catch {
      response.writeHead(404, { "Cache-Control": "no-store" }).end();
    }
  });

  await new Promise<void>((resolveListening, rejectListening) => {
    server.once("error", rejectListening);
    server.listen(options.port, "127.0.0.1", () => resolveListening());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return { server, url: `http://127.0.0.1:${port}/`, files };
}

async function serveWslAcceptance(options: ServeWslAcceptanceOptions): Promise<void> {
  const { server, url, files } = await startWslAcceptanceServer(options);
  success(`WSL acceptance download server is listening at ${url}`);
  console.log(files.map((file) => `  ${file}`).join("\n"));
  console.log("\nKeep this process running while performing the Desktop acceptance flow.\n");
  const close = () => server.close(() => process.exit(0));
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

if (isDirectExecution(import.meta.url)) {
  serveWslAcceptance(parseServeWslAcceptanceArgs(process.argv.slice(2))).catch((serveError) => {
    error(serveError instanceof Error ? serveError.message : String(serveError));
    process.exit(1);
  });
}
