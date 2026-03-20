// @ts-nocheck
import { setTimeout as delay } from 'node:timers/promises';
import { buildEndpoint } from './config.mjs';

function adminEndpoint(endpoint) {
  const url = new URL(endpoint);
  const host = url.hostname;
  if (host === '0.0.0.0' || host === '::' || host === '[::]') {
    url.hostname = '127.0.0.1';
  }
  return url.toString().replace(/\/$/, '');
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok || body?.ok === false) {
    const error = body?.error || `${response.status}`;
    throw new Error(error);
  }

  return body?.data ?? body ?? null;
}

export async function fetchHealth(endpoint) {
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/health`);
  if (!response.ok) {
    throw new Error(`health_http_${response.status}`);
  }
  return response.json();
}

export async function waitForHealth(endpoint, { timeoutMs = 15000, intervalMs = 250 } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fetchHealth(endpoint);
    } catch (error) {
      lastError = error;
      await delay(intervalMs);
    }
  }
  throw lastError ?? new Error('health_timeout');
}

export async function requestShutdown(endpoint) {
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/api/system/shutdown`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`shutdown_http_${response.status}`);
  }

  return response.json().catch(() => ({ ok: true }));
}

export async function fetchAdminConfig(endpoint) {
  return requestJson(`${adminEndpoint(endpoint)}/api/system/config`, { method: 'GET' });
}

export async function patchAdminConfig(endpoint, updates) {
  return requestJson(`${adminEndpoint(endpoint)}/api/system/config`, {
    method: 'PATCH',
    body: JSON.stringify({ updates }),
  });
}

export async function fetchAdminAuthStatus(endpoint) {
  return requestJson(`${adminEndpoint(endpoint)}/api/system/auth/status`, { method: 'GET' });
}

export async function fetchAdminIpBlocks(endpoint) {
  return requestJson(`${adminEndpoint(endpoint)}/api/system/auth/ip-blocks`, { method: 'GET' });
}

export async function unblockAdminIp(endpoint, payload) {
  return requestJson(`${adminEndpoint(endpoint)}/api/system/auth/ip-blocks/unblock`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function buildAdminEndpoint(host, port) {
  return adminEndpoint(buildEndpoint(host, port));
}
