import type { MonitoringSeriesPoint } from "@coder-studio/core";

export function Sparkline({
  points,
  metric,
  width = 96,
  height = 28,
}: {
  points: MonitoringSeriesPoint[];
  metric: "cpuPercent" | "memoryBytes";
  width?: number;
  height?: number;
}) {
  const values = points
    .map((point) => point[metric] ?? null)
    .filter((value): value is number => value !== null);

  if (values.length === 0) {
    return <div className="monitoring-sparkline monitoring-sparkline--empty">-</div>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coordinates = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${x},${y}`;
  });

  return (
    <svg className="monitoring-sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline className="monitoring-sparkline__line" fill="none" points={coordinates.join(" ")} />
    </svg>
  );
}
