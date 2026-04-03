import { planTerminalSnapshotUpdate } from "../../shared/utils/stream-snapshot";

type TerminalWriter = {
  reset: () => void;
  write: (value: string) => void;
};

type SyncXtermOutputStateArgs = {
  term: TerminalWriter;
  previousIdentity?: string;
  nextIdentity?: string;
  previousOutput: string;
  nextOutput: string;
  outputSyncStrategy: "snapshot" | "incremental" | "replace";
  hasImperativeWrites: boolean;
};

type SyncXtermOutputStateResult = {
  snapshot: string;
  hasImperativeWrites: boolean;
};

const writeXtermSnapshot = (
  term: TerminalWriter,
  previous: string,
  next: string,
) => {
  const plan = planTerminalSnapshotUpdate(previous, next);
  if (plan.kind === "noop") return;
  if (plan.kind === "append") {
    term.write(plan.data);
    return;
  }
  term.reset();
  if (plan.data) {
    term.write(plan.data);
  }
};

const hasComplexAnsiControl = (value: string) => (
  /\u001b(?:\[[0-9;?]*[A-HJKSTfhlsu]|\][^\u0007]*(?:\u0007|\u001b\\))/.test(value)
);

export const syncXtermOutputState = ({
  term,
  previousIdentity,
  nextIdentity,
  previousOutput,
  nextOutput,
  outputSyncStrategy,
  hasImperativeWrites,
}: SyncXtermOutputStateArgs): SyncXtermOutputStateResult => {
  if (previousIdentity !== nextIdentity) {
    term.reset();
    writeXtermSnapshot(term, "", nextOutput);
    return {
      snapshot: nextOutput,
      hasImperativeWrites: false,
    };
  }

  if (outputSyncStrategy === "replace") {
    term.reset();
    if (nextOutput) {
      term.write(nextOutput);
    }
    return {
      snapshot: nextOutput,
      hasImperativeWrites: false,
    };
  }

  if (outputSyncStrategy === "incremental") {
    if (hasImperativeWrites) {
      const plan = planTerminalSnapshotUpdate(previousOutput, nextOutput);
      if (plan.kind === "append") {
        if (hasComplexAnsiControl(plan.data)) {
          term.reset();
          if (nextOutput) {
            term.write(nextOutput);
          }
          return {
            snapshot: nextOutput,
            hasImperativeWrites: false,
          };
        }
        term.write(plan.data);
        return {
          snapshot: nextOutput,
          hasImperativeWrites: true,
        };
      }
      if (plan.kind === "replace") {
        term.reset();
        if (plan.data) {
          term.write(plan.data);
        }
        return {
          snapshot: nextOutput,
          hasImperativeWrites: false,
        };
      }
      return {
        snapshot: nextOutput,
        hasImperativeWrites: true,
      };
    }

    writeXtermSnapshot(term, previousOutput, nextOutput);
    return {
      snapshot: nextOutput,
      hasImperativeWrites: false,
    };
  }

  if (hasImperativeWrites) {
    term.reset();
    if (nextOutput) {
      term.write(nextOutput);
    }
    return {
      snapshot: nextOutput,
      hasImperativeWrites: false,
    };
  }

  writeXtermSnapshot(term, previousOutput, nextOutput);
  return {
    snapshot: nextOutput,
    hasImperativeWrites: false,
  };
};
