import type { FastifyRequest } from "fastify";

const RESERVED_PREFIXES = ["/api/", "/auth/", "/internal/", "/assets/"];
const RESERVED_EXACT_PATHS = new Set(["/api", "/auth", "/assets", "/healthz", "/internal", "/ws"]);
const ROOT_PUBLIC_FILE_PATHS = new Set([
  "/dev-browser-sw.js",
  "/favicon.ico",
  "/index.html",
  "/task-complete.wav",
]);

export function getRequestPathname(url: string): string {
  return url.split("?", 1)[0] || "/";
}

export function isFileLikePath(pathname: string): boolean {
  return /\/[^/?]+\.[^/?/]+$/.test(pathname);
}

export function isReservedWebPath(pathname: string): boolean {
  return (
    RESERVED_EXACT_PATHS.has(pathname) ||
    RESERVED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export function isPublicStaticPath(pathname: string): boolean {
  return pathname.startsWith("/assets/") || ROOT_PUBLIC_FILE_PATHS.has(pathname);
}

export function isFrontendNavigationRequest(
  request: Pick<FastifyRequest, "method" | "url" | "headers">
): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const pathname = getRequestPathname(request.url);
  if (isReservedWebPath(pathname) || isPublicStaticPath(pathname) || isFileLikePath(pathname)) {
    return false;
  }

  const accept = request.headers.accept ?? "";
  return accept.includes("text/html");
}
