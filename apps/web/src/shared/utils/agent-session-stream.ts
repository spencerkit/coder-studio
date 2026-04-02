import { sanitizeAnsiStream } from "./ansi";

export const sanitizeAgentSessionStream = (value: string) => sanitizeAnsiStream(value);
