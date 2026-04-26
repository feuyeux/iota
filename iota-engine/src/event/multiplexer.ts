import type { RuntimeEvent } from "./types.js";
import type { RuntimeEventStore } from "./store.js";

export class EventMultiplexer {
  private readonly live = new Map<string, Set<(event: RuntimeEvent) => void>>();
  private readonly completions = new Map<string, boolean>();
  /** Wake functions for subscribers waiting on empty queue */
  private readonly wakers = new Map<string, Set<() => void>>();

  constructor(private readonly store: RuntimeEventStore) {}

  async publish(event: RuntimeEvent): Promise<void> {
    const consumers = this.live.get(event.executionId);
    if (!consumers) {
      return;
    }
    for (const consumer of consumers) {
      consumer(event);
    }
  }

  complete(executionId: string): void {
    this.completions.set(executionId, true);
    // Wake all waiting subscribers so they re-check the completion flag and exit
    const wakers = this.wakers.get(executionId);
    if (wakers) {
      for (const wake of wakers) {
        wake();
      }
    }
    this.live.delete(executionId);
    this.wakers.delete(executionId);
    // Clean up completion flag after a grace period for late subscribers.
    setTimeout(() => this.completions.delete(executionId), 60_000);
  }

  async *subscribe(
    executionId: string,
    afterSequence = 0,
  ): AsyncIterable<RuntimeEvent> {
    // Already done — just replay
    if (this.completions.get(executionId)) {
      for (const event of await this.store.replay(executionId, afterSequence)) {
        yield event;
      }
      return;
    }

    const queue: RuntimeEvent[] = [];
    let wake: (() => void) | undefined;
    let lastYieldedSequence = afterSequence;

    const push = (event: RuntimeEvent): void => {
      queue.push(event);
      wake?.();
    };

    // 1. Register live consumer BEFORE replaying to avoid gap
    const set =
      this.live.get(executionId) ?? new Set<(event: RuntimeEvent) => void>();
    set.add(push);
    this.live.set(executionId, set);

    // Register a waker so complete() can wake us without sending fake events
    const registerWake = (fn: () => void) => {
      const wakers = this.wakers.get(executionId) ?? new Set();
      wakers.add(fn);
      this.wakers.set(executionId, wakers);
      return () => wakers.delete(fn);
    };

    try {
      // 2. Replay persisted events
      for (const event of await this.store.replay(executionId, afterSequence)) {
        lastYieldedSequence = event.sequence;
        yield event;
      }

      // Check completion again after replay
      if (this.completions.get(executionId) && queue.length === 0) {
        return;
      }

      // 3. Consume live events, deduplicating any that were already replayed
      while (!this.completions.get(executionId) || queue.length > 0) {
        if (queue.length === 0) {
          if (this.completions.get(executionId)) break;
          await new Promise<void>((resolve) => {
            wake = resolve;
            // Also register with wakers so complete() can wake us
            const unregister = registerWake(resolve);
            // Clean up on resolve
            const origResolve = resolve;
            wake = () => {
              unregister();
              origResolve();
            };
          });
          wake = undefined;
        }
        while (queue.length > 0) {
          const event = queue.shift();
          if (event && event.sequence > lastYieldedSequence) {
            lastYieldedSequence = event.sequence;
            yield event;
          }
        }
      }
    } finally {
      set.delete(push);
    }
  }
}
