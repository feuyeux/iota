import crypto from "node:crypto";
import type { RedactionSummary } from "./types.js";

/**
 * Secret patterns that must be redacted from visibility data.
 * Matches env var names ending in _TOKEN, _KEY, _SECRET, PASSWORD,
 * and common CLI flags like --api-key, --token, --password.
 */
const SECRET_ENV_PATTERN =
  /(?:_TOKEN|_KEY|_SECRET|PASSWORD|AUTHORIZATION|COOKIE)$/i;
const SECRET_FLAG_PATTERN = /--(?:api[_-]?key|token|password|secret|auth)\b/i;

const KNOWN_SECRET_ENVS = new Set([
  "IOTA_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "Authorization",
  "Cookie",
  "Set-Cookie",
]);

export function isSecretEnvName(name: string): boolean {
  return KNOWN_SECRET_ENVS.has(name) || SECRET_ENV_PATTERN.test(name);
}

/**
 * Summarize env vars: present / absent / redacted.
 */
export function summarizeEnv(
  env: Record<string, string | undefined>,
): Record<string, "present" | "absent" | "redacted"> {
  const summary: Record<string, "present" | "absent" | "redacted"> = {};
  for (const [key, value] of Object.entries(env)) {
    if (isSecretEnvName(key)) {
      summary[key] = value ? "redacted" : "absent";
    } else {
      summary[key] = value ? "present" : "absent";
    }
  }
  return summary;
}

/**
 * Pattern for key=value args where key looks like a secret name.
 * Matches: openai_api_key=..., api_token=..., db_password=..., client_secret=...
 */
const SECRET_KV_PATTERN =
  /^([A-Za-z0-9_.-]*(?:_key|_token|_secret|_password|api[_-]?key|authorization|cookie))=(.+)$/i;

/**
 * Redact secret values from CLI argument arrays.
 * Replaces values of known secret flags with '[REDACTED]'.
 * Also catches key=value patterns (e.g. `-c openai_api_key=sk-xxx`).
 */
export function redactArgs(args: string[]): {
  args: string[];
  redaction: RedactionSummary;
} {
  const redacted: string[] = [];
  const fields: string[] = [];
  let prevWasSecretFlag = false;

  for (const arg of args) {
    if (prevWasSecretFlag) {
      redacted.push("[REDACTED]");
      prevWasSecretFlag = false;
      continue;
    }
    if (SECRET_FLAG_PATTERN.test(arg)) {
      // --api-key=VALUE or --api-key VALUE
      if (arg.includes("=")) {
        const eqIndex = arg.indexOf("=");
        const flagName = arg.slice(0, eqIndex);
        fields.push(flagName);
        redacted.push(`${flagName}=[REDACTED]`);
      } else {
        fields.push(arg);
        redacted.push(arg);
        prevWasSecretFlag = true;
      }
    } else {
      const kvMatch = SECRET_KV_PATTERN.exec(arg);
      if (kvMatch) {
        fields.push(kvMatch[1]);
        redacted.push(`${kvMatch[1]}=[REDACTED]`);
      } else {
        redacted.push(arg);
      }
    }
  }

  return {
    args: redacted,
    redaction: {
      applied: fields.length > 0,
      fields,
      patterns:
        fields.length > 0 ? ["SECRET_FLAG_PATTERN", "SECRET_KV_PATTERN"] : [],
    },
  };
}

/**
 * Redact secrets from text content.
 * Replaces bearer tokens, API keys, and common secret patterns.
 */
const SECRET_VALUE_PATTERNS = [
  /(?:Bearer|Basic)\s+[A-Za-z0-9+/=_-]{20,}/g,
  /(?:^|[^a-zA-Z])(?:sk|pk|api|key|token|secret|password)[_-][A-Za-z0-9+/=]{20,}/gi,
];

export function redactText(text: string): {
  text: string;
  redaction: RedactionSummary;
} {
  const hashBefore = contentHash(text);
  const patterns: string[] = [];
  let result = text;

  for (const pattern of SECRET_VALUE_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    if (regex.test(result)) {
      patterns.push(pattern.source);
      result = result.replace(
        new RegExp(pattern.source, pattern.flags),
        "[REDACTED]",
      );
    }
  }

  const applied = patterns.length > 0;
  return {
    text: result,
    redaction: {
      applied,
      fields: [],
      patterns,
      contentHashBefore: applied ? hashBefore : undefined,
      contentHashAfter: applied ? contentHash(result) : undefined,
    },
  };
}

/**
 * Redact secret-like values from structured data before it is written to
 * visibility, audit, or logs. Secret-looking keys are replaced entirely; string
 * values under non-secret keys still go through value-pattern redaction.
 */
export function redactStructuredData(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactText(value).text;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value))
    return value.map((item) => redactStructuredData(item));
  if (typeof value !== "object") return undefined;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSecretEnvName(key) || SECRET_KV_PATTERN.test(`${key}=x`)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = redactStructuredData(item);
    }
  }
  return result;
}

/**
 * Generate a content hash (SHA-256 truncated to 16 hex chars).
 */
export function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Generate a preview of text content, truncated to maxChars.
 */
export function makePreview(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "…";
}

export function emptyRedaction(): RedactionSummary {
  return { applied: false, fields: [], patterns: [] };
}
