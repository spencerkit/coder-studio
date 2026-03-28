type TerminalFitHandle = {
  fit: () => void;
};

export const fitAgentTerminalHandles = (
  handles: Map<string, TerminalFitHandle | null>,
) => {
  handles.forEach((handle) => handle?.fit());
};
