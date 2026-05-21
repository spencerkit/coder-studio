/**
 * Subscription Management
 *
 * Handles topic subscriptions with pattern matching and deduplication.
 */

import { Topics } from "@coder-studio/core";

export type EventHandler = (topic: string, payload: unknown, seq: number) => void;

export interface Subscription {
  id: string;
  topics: string[];
  handler: EventHandler;
}

/**
 * Check if a topic matches a pattern
 * Supports wildcard matching with prefix globs, mirroring the server matcher.
 * Examples:
 * - workspace.* matches workspace.ws_1.meta
 * - workspace.ws_1.terminal.* matches workspace.ws_1.terminal.term_1.created
 */
export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === topic || pattern === "*") {
    return true;
  }

  const patternParts = pattern.split(".");
  const topicParts = topic.split(".");

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];

    if (patternPart === "*") {
      if (i === patternParts.length - 1) {
        return true;
      }
      continue;
    }

    if (i >= topicParts.length || patternPart !== topicParts[i]) {
      return false;
    }
  }

  return patternParts.length <= topicParts.length;
}

/**
 * Subscription manager
 */
export class SubscriptionManager {
  private subscriptions = new Map<string, Subscription>();
  private nextId = 1;

  /**
   * Add a subscription
   */
  subscribe(topics: string[], handler: EventHandler): string {
    const id = `sub_${this.nextId++}`;
    this.subscriptions.set(id, { id, topics, handler });
    return id;
  }

  /**
   * Remove a subscription by ID
   */
  unsubscribe(id: string): void {
    this.subscriptions.delete(id);
  }

  /**
   * Dispatch event to matching subscriptions
   */
  dispatch(topic: string, payload: unknown, seq: number): void {
    for (const sub of this.subscriptions.values()) {
      for (const pattern of sub.topics) {
        if (topicMatches(pattern, topic)) {
          try {
            sub.handler(topic, payload, seq);
          } catch (err) {
            console.error(`Error in subscription handler for ${topic}:`, err);
          }
          break; // Only call handler once per subscription
        }
      }
    }
  }

  /**
   * Get all subscribed topics
   */
  getTopics(): string[] {
    const topics = new Set<string>();
    for (const sub of this.subscriptions.values()) {
      for (const topic of sub.topics) {
        topics.add(topic);
      }
    }
    return Array.from(topics);
  }

  /**
   * Clear all subscriptions
   */
  clear(): void {
    this.subscriptions.clear();
  }

  /**
   * Get subscription count
   */
  size(): number {
    return this.subscriptions.size;
  }
}

/**
 * Create a topic pattern for workspace events
 */
export function workspaceTopic(workspaceId: string, ...parts: string[]): string {
  const key = parts.join(".");
  switch (key) {
    case "meta":
      return Topics.workspaceMeta(workspaceId);
    case "git.state":
      return Topics.workspaceGitState(workspaceId);
    case "fs.dirty":
      return Topics.workspaceFsDirty(workspaceId);
    default:
      return `workspace.${workspaceId}.${key}`;
  }
}

/**
 * Create a topic pattern for terminal events
 */
export function terminalTopic(workspaceId: string, terminalId: string, event: string): string {
  switch (event) {
    case "created":
      return Topics.terminalCreated(workspaceId, terminalId);
    case "output":
      return Topics.terminalOutput(workspaceId, terminalId);
    case "exit":
      return Topics.terminalExit(workspaceId, terminalId);
    default:
      return `workspace.${workspaceId}.terminal.${terminalId}.${event}`;
  }
}

/**
 * Create a topic pattern for session events
 */
export function sessionTopic(workspaceId: string, sessionId: string, event: string): string {
  switch (event) {
    case "state":
      return Topics.sessionState(workspaceId, sessionId);
    case "progress":
      return Topics.sessionProgress(workspaceId, sessionId);
    case "supervisor.state":
      return Topics.supervisorState(workspaceId, sessionId);
    default:
      return `workspace.${workspaceId}.session.${sessionId}.${event}`;
  }
}
