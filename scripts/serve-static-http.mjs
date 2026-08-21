import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import http from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

function usage(message) {
  if (message) console.error(message);
  console.error(
    "Usage: node scripts/serve-static-http.mjs --directory <path> --port <number> [--host <host>]"
  );
  process.exit(1);
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value) usage(`Missing value for ${name}`);
  return value;
}

function contentType(path) {
  switch (extname(path).toLowerCase()) {
    case ".json":
      return "application/json; charset=utf-8";
    case ".yml":
    case ".yaml":
      return "application/yaml; charset=utf-8";
    case ".tgz":
      return "application/gzip";
    case ".txt":
    case ".log":
      return "text/plain; charset=utf-8";
    case ".exe":
    case ".blockmap":
    default:
      return "application/octet-stream";
  }
}

const args = process.argv.slice(2);
const directoryArg = readOption(args, "--directory");
const host = readOption(args, "--host") ?? "127.0.0.1";
const portArg = readOption(args, "--port");
if (!directoryArg || !portArg) usage();

const root = resolve(directoryArg);
const port = Number(portArg);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  usage("--port must be an integer between 1 and 65535");
}

await access(root);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${host}`);
    const relative = normalize(decodeURIComponent(url.pathname.replace(/^\/+/, "")));
    const candidate = resolve(join(root, relative));
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const file = await stat(candidate).catch(() => null);
    if (!file?.isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    const headers = {
      "Content-Length": String(file.size),
      "Content-Type": contentType(candidate),
      "Cache-Control": "no-store",
    };
    if (req.method === "HEAD") {
      res.writeHead(200, headers).end();
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end("method not allowed");
      return;
    }
    res.writeHead(200, headers);
    const stream = createReadStream(candidate);
    stream.on("error", () => {
      if (!res.headersSent) res.writeHead(500);
      res.end("internal error");
    });
    stream.pipe(res);
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end("internal error");
  }
});

server.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

server.listen(port, host);
