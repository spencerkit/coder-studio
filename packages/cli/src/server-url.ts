import type { ServerStatus } from './server-control.js';

function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '::0';
}

function formatUrlHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

export function getListenIp(status: ServerStatus): string | null {
  return status.host;
}

export function getListenUrl(status: ServerStatus): string | null {
  if (status.host === null || status.port === null) {
    return null;
  }

  return `http://${formatUrlHost(status.host)}:${status.port}`;
}

export function getBrowserUrl(status: ServerStatus): string | null {
  if (status.port === null) {
    return null;
  }

  const host =
    status.host === null || status.host === 'localhost' || isWildcardHost(status.host)
      ? '127.0.0.1'
      : formatUrlHost(status.host);

  return `http://${host}:${status.port}`;
}
