export interface SupervisorLogger {
  warn(context: Record<string, unknown>, message: string): void;
  error?(context: Record<string, unknown>, message: string): void;
}

export const noopLogger: SupervisorLogger = {
  warn: () => {},
  error: () => {},
};
