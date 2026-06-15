const SESSION_MESSAGE_TYPE = "coder-studio-dev-browser-session";
const sessions = new Map();
const clientSessions = new Map();

function getSessionIdFromProxyPath(pathname) {
  const match = /^\/dev-browser\/session\/([^/]+)\/proxy(?:\/|$)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function getSessionForRequest(input) {
  if (input.clientSessionId && input.sessions[input.clientSessionId]) {
    return input.sessions[input.clientSessionId];
  }

  const requestUrl = new URL(input.requestUrl);
  const fromRequest = getSessionIdFromProxyPath(requestUrl.pathname);
  if (fromRequest && input.sessions[fromRequest]) {
    return input.sessions[fromRequest];
  }

  if (input.referrer) {
    const referrerUrl = new URL(input.referrer);
    const fromReferrer = getSessionIdFromProxyPath(referrerUrl.pathname);
    if (fromReferrer && input.sessions[fromReferrer]) {
      return input.sessions[fromReferrer];
    }
  }

  return null;
}

function isLoopbackUrlForSession(url, session) {
  if (url.protocol !== "http:") {
    return false;
  }

  const target = new URL(session.targetOrigin);
  return (
    url.port === target.port &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
  );
}

function getPortForUrl(url) {
  if (url.port) {
    return url.port;
  }
  return url.protocol === "https:" ? "443" : "80";
}

function isCoderStudioPlatformPath(pathname) {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname === "/healthz" ||
    pathname === "/internal" ||
    pathname.startsWith("/internal/") ||
    pathname === "/ws"
  );
}

function mapRequestToProxy(input) {
  const requestUrl = new URL(input.requestUrl);
  const session = getSessionForRequest(input);
  if (!session) {
    return null;
  }

  if (requestUrl.pathname.startsWith(session.browserProxyBase)) {
    return null;
  }

  if (requestUrl.origin === self.location.origin) {
    const currentPort = getPortForUrl(new URL(self.location.origin));
    const targetPort = getPortForUrl(new URL(session.targetOrigin));
    if (requestUrl.pathname.startsWith("/dev-browser/")) {
      return null;
    }
    if (
      requestUrl.pathname !== "/ws" &&
      (currentPort === targetPort || session.preserveStudioPlatformPaths === true) &&
      isCoderStudioPlatformPath(requestUrl.pathname)
    ) {
      return null;
    }
    return `${self.location.origin}${session.browserProxyBase}${requestUrl.pathname}${requestUrl.search}`;
  }

  if (isLoopbackUrlForSession(requestUrl, session)) {
    return `${self.location.origin}${session.browserProxyBase}${requestUrl.pathname}${requestUrl.search}`;
  }

  return null;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== SESSION_MESSAGE_TYPE || !event.data.session?.id) {
    return;
  }

  sessions.set(event.data.session.id, event.data.session);
  if (event.source?.id) {
    clientSessions.set(event.source.id, event.data.session.id);
  }
});

self.addEventListener("fetch", (event) => {
  const clientSessionId = event.clientId ? clientSessions.get(event.clientId) : undefined;
  const mappedUrl = mapRequestToProxy({
    requestUrl: event.request.url,
    referrer: event.request.referrer,
    clientSessionId,
    sessions: Object.fromEntries(sessions.entries()),
  });

  if (!mappedUrl) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(Response.redirect(mappedUrl, 302));
    return;
  }

  const proxiedRequest = new Request(mappedUrl, event.request);
  event.respondWith(fetch(proxiedRequest));
});

self.__coderStudioDevBrowserSwTest = {
  mapRequest: mapRequestToProxy,
};
