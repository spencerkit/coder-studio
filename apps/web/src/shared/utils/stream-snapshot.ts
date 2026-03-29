export type TerminalSnapshotUpdate =
  | { kind: "noop" }
  | { kind: "append"; data: string }
  | { kind: "replace"; data: string };

const DEFAULT_OVERLAP_PROBE_LIMIT = 256;

const trimTail = (value: string, limit: number) => {
  if (limit <= 0 || value.length <= limit) {
    return value;
  }
  return value.slice(-limit);
};

const resolveAppendDelta = (previous: string, next: string) => {
  if (next === previous) return "";
  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }

  const maxProbeLength = Math.min(DEFAULT_OVERLAP_PROBE_LIMIT, next.length);
  for (let probeLength = maxProbeLength; probeLength >= 1; probeLength -= 1) {
    const probe = next.slice(0, probeLength);
    const overlapStart = previous.lastIndexOf(probe);
    if (overlapStart === -1) continue;

    const overlap = previous.slice(overlapStart);
    if (!next.startsWith(overlap)) continue;
    return next.slice(overlap.length);
  }

  return null;
};

export const mergeMonotonicTextSnapshot = (
  current: string,
  incoming: string,
  limit: number,
) => {
  const existing = trimTail(current, limit);
  const next = trimTail(incoming, limit);

  if (next === existing || !next) {
    return existing;
  }
  if (!existing) {
    return next;
  }
  if (existing.includes(next)) {
    return existing;
  }
  if (next.includes(existing)) {
    return next;
  }

  const nextDelta = resolveAppendDelta(existing, next);
  if (nextDelta !== null) {
    return nextDelta ? trimTail(`${existing}${nextDelta}`, limit) : existing;
  }

  const existingDelta = resolveAppendDelta(next, existing);
  if (existingDelta !== null) {
    return existingDelta ? trimTail(`${next}${existingDelta}`, limit) : existing;
  }

  return existing.length >= next.length ? existing : next;
};

export const planTerminalSnapshotUpdate = (
  previous: string,
  next: string,
): TerminalSnapshotUpdate => {
  if (next === previous) {
    return { kind: "noop" };
  }
  if (!next || previous.includes(next)) {
    return { kind: "noop" };
  }

  const delta = resolveAppendDelta(previous, next);
  if (delta !== null) {
    return delta
      ? { kind: "append", data: delta }
      : { kind: "noop" };
  }

  return { kind: "replace", data: next };
};
