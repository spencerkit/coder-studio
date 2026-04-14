import { z } from 'zod';

// Command: client → server, expects Result
export const CommandMessage = z.object({
  kind: z.literal('command'),
  id: z.string().uuid(),
  op: z.string(),
  args: z.unknown(),
});

// Result: server → client, response to Command
export const ResultMessage = z.object({
  kind: z.literal('result'),
  id: z.string().uuid(),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    })
    .optional(),
});

// Event: server → client, unsolicited state change
export const EventMessage = z.object({
  kind: z.literal('event'),
  topic: z.string(),
  seq: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
  data: z.unknown(),
});

// Subscribe: client → server, declare interest in topics
export const SubscribeMessage = z.object({
  kind: z.literal('subscribe'),
  topics: z.array(z.string()),
});

// Unsubscribe: client → server, cancel interest
export const UnsubscribeMessage = z.object({
  kind: z.literal('unsubscribe'),
  topics: z.array(z.string()),
});

// Resync: client → server, request missed events after reconnect
export const ResyncMessage = z.object({
  kind: z.literal('resync'),
  lastSeen: z.record(z.string(), z.number()),
});

// Client → Server messages
export const ClientMessage = z.discriminatedUnion('kind', [
  CommandMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  ResyncMessage,
]);

// Server → Client messages
export const ServerMessage = z.discriminatedUnion('kind', [ResultMessage, EventMessage]);

// Type exports
export type Command = z.infer<typeof CommandMessage>;
export type Result = z.infer<typeof ResultMessage>;
export type Event = z.infer<typeof EventMessage>;
export type Subscribe = z.infer<typeof SubscribeMessage>;
export type Unsubscribe = z.infer<typeof UnsubscribeMessage>;
export type Resync = z.infer<typeof ResyncMessage>;
export type ClientToServer = z.infer<typeof ClientMessage>;
export type ServerToClient = z.infer<typeof ServerMessage>;