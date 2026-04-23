/**
 * Notification Feature
 *
 * PRD §15: Notification System
 * - Session completion notifications (sound + browser push + in-app toast)
 * - Toast container UI with Slide In animation
 * - Respects notification settings from Settings → General
 */

export { useSessionNotifications } from './use-session-notifications';
export { ToastContainer } from './toast-container';
export { toastsAtom, pushToastAtom, dismissToastAtom, type Toast, type ToastKind } from './atoms';
