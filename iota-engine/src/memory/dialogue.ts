import type { Message } from "../event/types.js";

/**
 * Dialogue memory — stores the conversation turn history for each session.
 * Provides multi-turn working context so subsequent executions see prior
 * messages. Kept in-memory; not persisted across process restarts.
 */
export class DialogueMemory {
  private readonly messages = new Map<string, Message[]>();
  /** Insertion-order queue for LRU eviction of stale sessions. */
  private readonly sessionOrder: string[] = [];
  private readonly maxSessions: number;

  constructor(maxSessions = 1000) {
    this.maxSessions = maxSessions;
  }

  append(sessionId: string, message: Message): void {
    const existing = this.messages.get(sessionId) ?? [];
    if (existing.length === 0) {
      // New session — track order and enforce cap.
      this.sessionOrder.push(sessionId);
      this.evictIfNeeded();
    }
    existing.push(message);
    this.messages.set(sessionId, existing.slice(-50));
  }

  getConversation(sessionId: string): Message[] {
    return [...(this.messages.get(sessionId) ?? [])];
  }

  clearSession(sessionId: string): void {
    this.messages.delete(sessionId);
    const idx = this.sessionOrder.indexOf(sessionId);
    if (idx !== -1) this.sessionOrder.splice(idx, 1);
  }

  private evictIfNeeded(): void {
    while (this.sessionOrder.length > this.maxSessions) {
      const oldest = this.sessionOrder.shift();
      if (oldest) this.messages.delete(oldest);
    }
  }
}
