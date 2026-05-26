export function formatPercent(value: number | null): string {
  return value == null ? "Unavailable" : `${value.toFixed(1)}%`;
}

export function formatBytes(value: number | null): string {
  if (value == null) {
    return "Unavailable";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let unitIndex = 0;

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }

  return `${current.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatUptime(value: number | null): string {
  if (value == null) {
    return "Unavailable";
  }

  if (value < 60) {
    return `${Math.round(value)}s`;
  }

  if (value < 3600) {
    return `${Math.round(value / 60)}m`;
  }

  return `${Math.round(value / 3600)}h`;
}

export function formatLoadAverage(value: [number, number, number] | null): string {
  return value == null ? "Unavailable" : value.map((item) => item.toFixed(2)).join(" / ");
}

export function formatRefreshInterval(value: number | null): string {
  return value == null ? "Unavailable" : `Refresh every ${Math.round(value / 1000)}s`;
}

export function formatTimestamp(value: number | null): string {
  if (value == null || value <= 0) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}
