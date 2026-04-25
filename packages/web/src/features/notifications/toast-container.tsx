/**
 * Toast Notification Container
 *
 * PRD §15 / Visual Spec: "Slide In" animation (translateX 100% → 0 with opacity).
 * Stacked in the bottom-right corner, max 5 visible.
 * Clicking a toast navigates to the relevant workspace/session.
 */

import { useEffect, useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { toastsAtom, dismissToastAtom, type Toast, type ToastKind } from './atoms';
import { activeWorkspaceIdAtom, pendingFocusSessionAtom } from '../../atoms/ui';
import { focusSession } from './focus-session';

const KIND_CONFIG: Record<ToastKind, { icon: typeof CheckCircle; className: string }> = {
  success: { icon: CheckCircle, className: 'toast--success' },
  error:   { icon: AlertCircle,  className: 'toast--error' },
  warning: { icon: AlertTriangle, className: 'toast--warning' },
  info:    { icon: Info,          className: 'toast--info' },
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useSetAtom(dismissToastAtom);
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const setPendingFocus = useSetAtom(pendingFocusSessionAtom);
  const navigate = useNavigate();
  const config = KIND_CONFIG[toast.kind];
  const Icon = config.icon;
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
      if (window.location.pathname !== '/workspace') {
        navigate('/workspace');
      }
    }
    dismiss(toast.id);
  }, [toast.workspaceId, toast.sessionId, navigate, dismiss, setActiveWorkspaceId, setPendingFocus]);

  return (
    <div
      className={`toast ${config.className}`}
      role="alert"
      onClick={handleClick}
      style={{ cursor: toast.workspaceId ? 'pointer' : 'default' }}
    >
      <Icon size={16} className="toast__icon" />
      <div className="toast__content">
        <span className="toast__title">{toast.title}</span>
        {toast.body && <span className="toast__body">{toast.body}</span>}
      </div>
      <button
        className="toast__close"
        onClick={(e) => { e.stopPropagation(); dismiss(toast.id); }}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useAtomValue(toastsAtom);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
