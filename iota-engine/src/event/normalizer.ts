import type { NewRuntimeEvent, RuntimeEvent } from "./types.js";

/**
 * Section 8.1: Event normalization
 * Ensures all events have proper sequence (assigned by EventStore),
 * timestamps, and consistent backend attribution.
 */
export function normalizeEvent(
  event: NewRuntimeEvent,
  sequence: number,
): RuntimeEvent {
  return {
    ...event,
    sequence,
    timestamp: event.timestamp ?? Date.now(),
  } as RuntimeEvent;
}

/**
 * Validate that an event has all required base fields.
 */
export function isValidEvent(event: unknown): event is RuntimeEvent {
  if (typeof event !== "object" || event === null) return false;
  const e = event as Record<string, unknown>;
  return (
    typeof e.type === "string" &&
    typeof e.sessionId === "string" &&
    typeof e.executionId === "string" &&
    typeof e.backend === "string" &&
    typeof e.sequence === "number" &&
    typeof e.timestamp === "number" &&
    e.data !== undefined
  );
}

/**
 * Strip sensitive fields from events before external exposure.
 * API keys should never appear in event payloads.
 */
export function sanitizeEvent(event: RuntimeEvent): RuntimeEvent {
  if (event.type !== "extension") return event;
  const payload = { ...event.data.payload };
  for (const key of Object.keys(payload)) {
    const k = key.toLowerCase();
    if (
      k.includes("key") ||
      k.includes("token") ||
      k.includes("secret") ||
      k.includes("password")
    ) {
      payload[key] = "[REDACTED]";
    }
  }
  return { ...event, data: { ...event.data, payload } };
}
