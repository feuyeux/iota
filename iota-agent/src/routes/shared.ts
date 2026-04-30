import type { FastifyReply } from "fastify";
import { BACKEND_NAMES } from "@iota/engine";

/** Shared Fastify JSON-schema fragment for the backend enum. */
export const BACKEND_ENUM_SCHEMA = {
  type: "string",
  enum: BACKEND_NAMES,
} as const;

/** Return a standard 404 response and set the status code on the reply. */
export function notFound(
  reply: FastifyReply,
  resource: string,
  id: string,
): { error: string; message: string; [key: string]: string } {
  reply.code(404);
  return {
    error: `${resource} not found`,
    message: `The ${resource.toLowerCase()} "${id}" does not exist or has been deleted.`,
    [`${resource.toLowerCase()}Id`]: id,
  };
}

/**
 * Parse a query-string time value into a Unix timestamp (ms).
 * Returns undefined if no value, a number on success, or an error string on failure.
 */
export function parseTime(
  value: string | undefined,
  fieldName: string,
): number | undefined | string {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return `${fieldName} must be a Unix timestamp in milliseconds or an ISO date`;
  }
  return timestamp;
}
