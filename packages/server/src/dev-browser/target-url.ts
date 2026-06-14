export class DevBrowserTargetUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevBrowserTargetUrlError";
  }
}

export interface DevBrowserTarget {
  connectHost: "127.0.0.1" | "::1";
  displayUrl: string;
  originalHost: "localhost" | "127.0.0.1" | "[::1]";
  port: number;
  targetHash: string;
  targetOrigin: string;
  targetPath: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

interface RawTargetAuthority {
  host: "localhost" | "127.0.0.1" | "[::1]";
  port: number;
}

function withDefaultProtocol(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new DevBrowserTargetUrlError("empty_url");
  }
  return /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function parsePort(portText: string): number {
  if (!portText) {
    throw new DevBrowserTargetUrlError("missing_port");
  }

  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DevBrowserTargetUrlError("invalid_port");
  }

  return port;
}

function parseRawAuthority(input: string): RawTargetAuthority {
  const authority = input.slice("http://".length).split(/[/?#]/, 1)[0] ?? "";

  if (authority.includes("@")) {
    throw new DevBrowserTargetUrlError("credentials_not_allowed");
  }

  let match: RegExpExecArray | null;
  if (authority.startsWith("[")) {
    match = /^(\[[^\]]+\]):(\d+)$/.exec(authority);
  } else {
    match = /^([^:]+):(\d+)$/.exec(authority);
  }

  if (!match) {
    throw new DevBrowserTargetUrlError("missing_port");
  }

  const host = match[1];
  const portText = match[2];
  if (host === undefined || portText === undefined) {
    throw new DevBrowserTargetUrlError("invalid_url");
  }

  if (!LOOPBACK_HOSTS.has(host)) {
    throw new DevBrowserTargetUrlError("host_not_allowed");
  }

  return {
    host: host as "localhost" | "127.0.0.1" | "[::1]",
    port: parsePort(portText),
  };
}

export function parseDevBrowserTargetUrl(input: string): DevBrowserTarget {
  const normalizedInput = withDefaultProtocol(input);

  let url: URL;
  try {
    url = new URL(normalizedInput);
  } catch {
    throw new DevBrowserTargetUrlError("invalid_url");
  }

  if (url.protocol !== "http:") {
    throw new DevBrowserTargetUrlError("unsupported_protocol");
  }

  const { host, port } = parseRawAuthority(normalizedInput);
  const connectHost = host === "[::1]" ? "::1" : "127.0.0.1";
  const targetOrigin = connectHost === "::1" ? `http://[::1]:${port}` : `http://127.0.0.1:${port}`;
  const targetPath = `${url.pathname || "/"}${url.search}`;

  return {
    connectHost,
    displayUrl: url.href,
    originalHost: host,
    port,
    targetHash: url.hash,
    targetOrigin,
    targetPath,
  };
}
