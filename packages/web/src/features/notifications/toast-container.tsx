/**
 * Toast Notification Container
 *
 * PRD §15 / Visual Spec: "Slide In" animation (translateX 100% → 0 with opacity).
 * Stacked in the bottom-right corner, max 5 visible.
 * Clicking a toast navigates to the relevant workspace/session.
 */

import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { pendingFocusSessionAtom } from "../../atoms/app-ui";
import { activeWorkspaceIdAtom } from "../../atoms/workspaces";
import { ToastViewport, Toast as UiToast } from "../../components/ui";
import { useViewport } from "../../hooks/use-viewport";
import { dismissToastAtom, type Toast, toastsAtom } from "./atoms";
import { focusSession } from "./focus-session";

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useSetAtom(dismissToastAtom);
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const setPendingFocus = useSetAtom(pendingFocusSessionAtom);
  const navigate = useNavigate();
  const duration = toast.duration ?? 5000;

  // Auto-dismiss
  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => dismiss(toast.id), duration);
    return () => clearTimeout(timer);
  }, [toast.id, duration, dismiss]);

  const handleClick = useCallback(() => {
    // If the toast was emitted with both a workspace AND a session id (the
    // session-completion path always is), route through `focusSession` so
    // the target SessionCard scrolls into view and pulses. Workspace-only
    // toasts (rare/legacy) just navigate.
    if (toast.workspaceId && toast.sessionId) {
      focusSession({
        workspaceId: toast.workspaceId,
        sessionId: toast.sessionId,
        setPendingFocus,
        setActiveWorkspaceId,
        navigate,
      });
    } else if (toast.workspaceId) {
      setActiveWorkspaceId(toast.workspaceId);
      if (window.location.pathname !== "/workspace") {
        navigate("/workspace");
      }
    }
    dismiss(toast.id);
  }, [
    toast.workspaceId,
    toast.sessionId,
    navigate,
    dismiss,
    setActiveWorkspaceId,
    setPendingFocus,
  ]);

  return (
    <UiToast
      description={toast.body}
      onClick={toast.workspaceId ? handleClick : undefined}
      onDismiss={() => dismiss(toast.id)}
      title={toast.title}
      tone={toast.kind}
    />
  );
}

export function ToastContainer() {
  const toasts = useAtomValue(toastsAtom);
  const isMobile = useViewport() === "mobile";

  if (toasts.length === 0) return null;

  return (
    <ToastViewport aria-live="polite" mobile={isMobile}>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </ToastViewport>
  );
}
