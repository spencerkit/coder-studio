import { setTimeout as delay } from 'node:timers/promises';

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
