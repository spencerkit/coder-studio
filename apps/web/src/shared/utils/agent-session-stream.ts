import { sanitizeAnsiStream } from "./ansi.ts";

export const sanitizeAgentSessionStream = (value: string) => sanitizeAnsiStream(value);
