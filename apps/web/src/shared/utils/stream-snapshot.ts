export type TerminalSnapshotUpdate =
  | { kind: "noop" }
  | { kind: "append"; data: string }
  | { kind: "replace"; data: string };

const trimTail = (value: string, limit: number) => {
  if (limit <= 0 || value.length <= limit) {
    return value;
  }
  return value.slice(-limit);
};

const OVERLAP_SEPARATOR = "\u0000";

const resolveSuffixPrefixOverlapLength = (previous: string, next: string) => {
  if (!previous || !next) {
    return 0;
  }

  const previousTail = previous.length <= next.length
    ? previous
    : previous.slice(-next.length);
  const combined = `${next}${OVERLAP_SEPARATOR}${previousTail}`;
  const prefix = new Array<number>(combined.length).fill(0);

  for (let index = 1; index < combined.length; index += 1) {
    let candidateLength = prefix[index - 1] ?? 0;
    while (candidateLength > 0 && combined[index] !== combined[candidateLength]) {
      candidateLength = prefix[candidateLength - 1] ?? 0;
    }
    if (combined[index] === combined[candidateLength]) {
      candidateLength += 1;
    }
    prefix[index] = candidateLength;
  }

  return Math.min(prefix[prefix.length - 1] ?? 0, previousTail.length, next.length);
};

const resolveAppendDelta = (previous: string, next: string) => {
  if (next === previous) return "";
  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }

  const overlapLength = resolveSuffixPrefixOverlapLength(previous, next);
  if (overlapLength > 0) {
    return next.slice(overlapLength);
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
