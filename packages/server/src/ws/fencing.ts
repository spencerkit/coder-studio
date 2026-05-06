/**
 * Fencing Token Management (Phase 3)
 *
 * Implements Controller/Observer model for multi-tab concurrency.
 * Only one tab can be the Controller with write access.
 */

import type { FastifyRequest } from "fastify";

export interface FencingToken {
  /** Unique client ID */
  clientId: string;
  /** Tab/session identifier */
  tabId: string;
  /** When the token was issued */
  issuedAt: number;
  /** Token expiration time */
  expiresAt: number;
  /** Client IP address */
  ip: string;
  /** User agent string */
  userAgent: string;
}

export interface FencingManagerOptions {
  /** Heartbeat interval for visible tabs (ms) */
  visibleHeartbeatMs: number;
  /** Heartbeat interval for hidden tabs (ms) */
  hiddenHeartbeatMs: number;
  /** Token expiration time (ms) */
  tokenExpirationMs: number;
  /** Grace period for tab refresh (ms) */
  refreshGraceMs: number;
}

const DEFAULT_OPTIONS: FencingManagerOptions = {
  visibleHeartbeatMs: 10000, // 10 seconds
  hiddenHeartbeatMs: 20000, // 20 seconds
  tokenExpirationMs: 30000, // 30 seconds
  refreshGraceMs: 3000, // 3 seconds
};

/**
 * Manages fencing tokens for workspace write access.
 */
export class FencingManager {
  private options: FencingManagerOptions;
  // workspaceId -> FencingToken
  private tokens = new Map<string, FencingToken>();
  // clientId -> last heartbeat timestamp
  private heartbeats = new Map<string, number>();
  // workspaceId -> { clientId, closedAt, ip, ua } (for grace period)
  private lastWriter = new Map<
    string,
    {
      clientId: string;
      closedAt: number;
      ip: string;
      userAgent: string;
    }
  >();

  constructor(options?: Partial<FencingManagerOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Request controller status for a workspace.
   * Returns whether this client is now the controller.
   */
  requestControl(
    workspaceId: string,
    clientId: string,
    tabId: string,
    request: FastifyRequest
  ): { isController: boolean; reason?: string } {
    const now = Date.now();
    const ip = request.ip;
    const userAgent = request.headers["user-agent"] ?? "";

    // Check if there's an existing controller
    const existing = this.tokens.get(workspaceId);

    if (existing) {
      // Check if existing token is expired
      if (now > existing.expiresAt) {
        // Token expired, take over
        this.tokens.delete(workspaceId);
      } else if (existing.clientId === clientId) {
        // Same client, refresh token
        return this.issueToken(workspaceId, clientId, tabId, ip, userAgent);
      } else {
        // Another client is controller
        return {
          isController: false,
          reason: "another_tab_active",
        };
      }
    }

    // Check grace period for tab refresh
    const lastWriter = this.lastWriter.get(workspaceId);
    if (lastWriter && now - lastWriter.closedAt < this.options.refreshGraceMs) {
      if (lastWriter.ip === ip && lastWriter.userAgent === userAgent) {
        // Same origin refresh, grant control
        return this.issueToken(workspaceId, clientId, tabId, ip, userAgent);
      }
    }

    // No existing controller, become one
    return this.issueToken(workspaceId, clientId, tabId, ip, userAgent);
  }

  /**
   * Record a heartbeat from a controller.
   */
  heartbeat(workspaceId: string, clientId: string): boolean {
    const token = this.tokens.get(workspaceId);
    if (!token || token.clientId !== clientId) {
      return false;
    }

    // Update heartbeat timestamp
    this.heartbeats.set(clientId, Date.now());

    // Extend token expiration
    token.expiresAt = Date.now() + this.options.tokenExpirationMs;

    return true;
  }

  /**
   * Release controller status.
   */
  release(workspaceId: string, clientId: string): void {
    const token = this.tokens.get(workspaceId);
    if (token && token.clientId === clientId) {
      // Store last writer info for grace period
      this.lastWriter.set(workspaceId, {
        clientId: token.clientId,
        closedAt: Date.now(),
        ip: token.ip,
        userAgent: token.userAgent,
      });

      this.tokens.delete(workspaceId);
      this.heartbeats.delete(clientId);
    }
  }

  /**
   * Check if a client is the current controller.
   */
  isController(workspaceId: string, clientId: string): boolean {
    const token = this.tokens.get(workspaceId);
    return token?.clientId === clientId;
  }

  /**
   * Get the current controller info for a workspace.
   */
  getController(workspaceId: string): FencingToken | undefined {
    const token = this.tokens.get(workspaceId);
    if (token && Date.now() <= token.expiresAt) {
      return token;
    }
    return undefined;
  }

  /**
   * Check if controller is unresponsive (no heartbeat).
   */
  isControllerUnresponsive(workspaceId: string): boolean {
    const token = this.tokens.get(workspaceId);
    if (!token) {
      return true;
    }

    const lastHeartbeat = this.heartbeats.get(token.clientId);
    if (!lastHeartbeat) {
      return true;
    }

    // Consider unresponsive if no heartbeat for 2x the visible heartbeat interval
    const unresponsiveThreshold = this.options.visibleHeartbeatMs * 2;
    return Date.now() - lastHeartbeat > unresponsiveThreshold;
  }

  /**
   * Force takeover of controller status.
   * Used when controller is unresponsive.
   */
  forceTakeover(
    workspaceId: string,
    clientId: string,
    tabId: string,
    request: FastifyRequest
  ): { success: boolean; reason?: string } {
    if (!this.isControllerUnresponsive(workspaceId)) {
      return {
        success: false,
        reason: "controller_responsive",
      };
    }

    // Clear existing token
    this.tokens.delete(workspaceId);

    // Issue new token
    const ip = request.ip;
    const userAgent = request.headers["user-agent"] ?? "";
    const result = this.issueToken(workspaceId, clientId, tabId, ip, userAgent);

    return { success: result.isController };
  }

  /**
   * Issue a new fencing token.
   */
  private issueToken(
    workspaceId: string,
    clientId: string,
    tabId: string,
    ip: string,
    userAgent: string
  ): { isController: boolean } {
    const now = Date.now();

    const token: FencingToken = {
      clientId,
      tabId,
      issuedAt: now,
      expiresAt: now + this.options.tokenExpirationMs,
      ip,
      userAgent,
    };

    this.tokens.set(workspaceId, token);
    this.heartbeats.set(clientId, now);

    // Clear last writer info
    this.lastWriter.delete(workspaceId);

    return { isController: true };
  }

  /**
   * Clean up expired tokens.
   */
  cleanup(): void {
    const now = Date.now();

    for (const [workspaceId, token] of this.tokens) {
      if (now > token.expiresAt) {
        this.tokens.delete(workspaceId);
        this.heartbeats.delete(token.clientId);
      }
    }

    // Clean up old last writer records (older than grace period * 2)
    const graceCutoff = now - this.options.refreshGraceMs * 2;
    for (const [workspaceId, lastWriter] of this.lastWriter) {
      if (lastWriter.closedAt < graceCutoff) {
        this.lastWriter.delete(workspaceId);
      }
    }
  }
}
