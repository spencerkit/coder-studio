export const resolveTerminalInteractionMode = (
  isActive: boolean,
  inputEnabled: boolean,
): "interactive" | "readonly" => (
  isActive && inputEnabled ? "interactive" : "readonly"
);
