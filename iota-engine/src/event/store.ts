import type {
  BackendName,
  NewRuntimeEvent,
  RuntimeEvent,
  StateEvent,
} from "./types.js";
import type { StorageBackend } from "../storage/interface.js";

export class RuntimeEventStore {
  private readonly sequences = new Map<string, number>();

  constructor(private readonly storage: StorageBackend) {}

  async append(event: NewRuntimeEvent): Promise<RuntimeEvent> {
    const sequence =
      event.sequence && event.sequence > 0
        ? event.sequence
        : this.nextSequence(event.executionId);
    const normalized = {
      ...event,
      sequence,
      timestamp: event.timestamp ?? Date.now(),
    } as RuntimeEvent;
    this.sequences.set(event.executionId, sequence);
    await this.storage.appendEvent(normalized);
    return normalized;
  }

  async appendState(
    sessionId: string,
    executionId: string,
    backend: BackendName,
    state: StateEvent["data"]["state"],
    message?: string,
  ): Promise<RuntimeEvent> {
    return this.append({
      type: "state",
      sessionId,
      executionId,
      backend,
      data: { state, message },
    });
  }

  async replay(
    executionId: string,
    afterSequence = 0,
  ): Promise<RuntimeEvent[]> {
    const events = await this.storage.readEvents(executionId, afterSequence);
    const last = events.at(-1);
    if (last) {
      this.sequences.set(
        executionId,
        Math.max(this.sequences.get(executionId) ?? 0, last.sequence),
      );
    }
    return events;
  }

  private nextSequence(executionId: string): number {
    const next = (this.sequences.get(executionId) ?? 0) + 1;
    this.sequences.set(executionId, next);
    return next;
  }
}
