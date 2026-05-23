import {
  RECOVERY_REASONS,
  type RecoveryReconcileDecision,
  type RecoveryReconcileResult,
} from "@coder-studio/core";
import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

const RecoveryReasonSchema = z.enum(RECOVERY_REASONS);

registerCommand(
  "recovery.reconcile",
  z.object({
    reason: RecoveryReasonSchema,
    terminals: z.array(
      z.object({
        terminalId: z.string(),
        renderedSeq: z.number().int().nonnegative(),
      })
    ),
  }),
  async (args, ctx): Promise<RecoveryReconcileResult> => {
    const terminals: RecoveryReconcileDecision[] = args.terminals.map((entry) => {
      const inspection = ctx.terminalMgr.inspectRecovery(entry.terminalId, entry.renderedSeq);

      if (inspection.status === "unknown") {
        return {
          terminalId: entry.terminalId,
          action: "unrecoverable",
          reason: "unknown_terminal",
        };
      }

      if (!inspection.alive && entry.renderedSeq >= inspection.headSeq) {
        return {
          terminalId: entry.terminalId,
          action: "closed",
          headSeq: inspection.headSeq,
          exitCode: inspection.exitCode,
        };
      }

      if (entry.renderedSeq === inspection.headSeq) {
        return {
          terminalId: entry.terminalId,
          action: "noop",
          headSeq: inspection.headSeq,
        };
      }

      if (args.reason === "initial_mount" && inspection.snapshot.kind === "available") {
        return {
          terminalId: entry.terminalId,
          action: "snapshot",
          headSeq: inspection.headSeq,
        };
      }

      if (inspection.replay.kind === "available") {
        return {
          terminalId: entry.terminalId,
          action: "replay",
          fromSeq: entry.renderedSeq,
          headSeq: inspection.headSeq,
          closed: inspection.alive ? undefined : { exitCode: inspection.exitCode },
        };
      }

      if (inspection.snapshot.kind === "available") {
        return {
          terminalId: entry.terminalId,
          action: "snapshot",
          headSeq: inspection.headSeq,
          closed: inspection.alive ? undefined : { exitCode: inspection.exitCode },
        };
      }

      if (!inspection.alive) {
        return {
          terminalId: entry.terminalId,
          action: "closed",
          headSeq: inspection.headSeq,
          exitCode: inspection.exitCode,
        };
      }

      return {
        terminalId: entry.terminalId,
        action: "unrecoverable",
        reason: "too_old_no_snapshot",
      };
    });

    return { terminals };
  }
);
