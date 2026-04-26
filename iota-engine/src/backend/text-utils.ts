/**
 * Shared text-extraction utilities for backend event parsing.
 *
 * The generic `extractText` walks a record looking for common text-bearing
 * fields (content, text, output, result, message, params) and recurses into
 * objects and arrays.  Backend-specific extractors (e.g. extractClaudeText)
 * may still live in their own adapter modules when they need protocol-specific
 * logic that doesn't generalise.
 */

/**
 * Recursively extract the first text value from a backend event record.
 * Checks common keys: content, text, output, result, message, params.
 */
export function extractText(
  value: Record<string, unknown>,
): string | undefined {
  for (const key of ["content", "text", "output", "result"]) {
    if (typeof value[key] === "string") {
      return value[key] as string;
    }
  }
  const message = value.message;
  if (typeof message === "string") {
    return message;
  }
  if (typeof message === "object" && message !== null) {
    return extractText(message as Record<string, unknown>);
  }
  const content = value.content;
  if (Array.isArray(content)) {
    const chunks = content
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null)
          return extractText(item as Record<string, unknown>);
        return undefined;
      })
      .filter((item): item is string => Boolean(item));
    return chunks.length > 0 ? chunks.join("") : undefined;
  }
  const params = value.params;
  if (typeof params === "object" && params !== null) {
    return extractText(params as Record<string, unknown>);
  }
  return undefined;
}

/** Safely extract a string property from a record. */
export function stringProp(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof value[key] === "string" ? (value[key] as string) : undefined;
}
