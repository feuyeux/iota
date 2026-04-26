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
