/**
 * Notification Feature
 *
 * PRD §15: Notification System
 * - Session completion notifications (sound + browser push + in-app toast)
 * - Toast container UI with Slide In animation
 * - Respects notification settings from Settings → General
 */

export {
  appendSessionOutputAtom,
  clearSessionOutputAtom,
  dismissToastAtom,
  pushToastAtom,
  sessionOutputTailAtom,
  type Toast,
  type ToastKind,
  toastsAtom,
} from "./atoms";
export { type FocusSessionOptions, focusSession } from "./focus-session";
export { ToastContainer } from "./toast-container";
export { useSessionNotifications } from "./use-session-notifications";
