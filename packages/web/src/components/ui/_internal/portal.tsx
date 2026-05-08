import { type ReactNode } from "react";
import { createPortal } from "react-dom";

interface PortalProps {
  readonly children: ReactNode;
}

export function Portal({ children }: PortalProps) {
  const mountNode = typeof document === "undefined" ? null : document.body;

  if (!mountNode) {
    return null;
  }

  return createPortal(children, mountNode);
}
