export function formatTokenMetric(value: number | undefined) {
  const tokenCount = value ?? 0;
  const unit =
    tokenCount >= 1_000_000_000
      ? { divisor: 1_000_000_000, suffix: "B" }
      : tokenCount >= 1_000_000
        ? { divisor: 1_000_000, suffix: "M" }
        : null;

  if (!unit) {
    return new Intl.NumberFormat().format(tokenCount);
  }

  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(tokenCount / unit.divisor)}${unit.suffix}`;
}
