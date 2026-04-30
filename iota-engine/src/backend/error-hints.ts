import { ErrorCode } from "../error/codes.js";
import type { BackendName } from "../event/types.js";

/**
 * Diagnostic hint derived from inspecting a backend's stdout / stderr / JSON
 * error payload. Captures a structured error code, a normalized human message,
 * and an actionable hint (typically a single shell command).
 */
export interface BackendIssue {
  code: ErrorCode;
  reason: "auth-required" | "quota-exceeded";
  message: string;
  hint: string;
  matchedPattern: string;
}

interface IssueRule {
  pattern: RegExp;
  reason: "auth-required" | "quota-exceeded";
  appliesTo?: BackendName[];
  /** Override the default hint resolved by `defaultHint(backend, reason)`. */
  hint?: (backend: BackendName) => string;
  message?: (matched: string) => string;
}

const QUOTA_RULES: IssueRule[] = [
  {
    pattern: /MODEL_CAPACITY_EXHAUSTED/i,
    reason: "quota-exceeded",
    message: (m) => `Backend reported model capacity exhausted: ${m}`,
  },
  {
    pattern: /RESOURCE_EXHAUSTED/i,
    reason: "quota-exceeded",
    message: (m) => `Backend reported resource exhausted (${m})`,
  },
  {
    pattern: /rateLimitExceeded|rate[ _-]?limit[ _-]?exceeded/i,
    reason: "quota-exceeded",
    message: (m) => `Backend reported rate limit exceeded (${m})`,
  },
  {
    pattern: /\b429\b[^0-9]*(too many requests|quota|rate)/i,
    reason: "quota-exceeded",
    message: () => "Backend returned HTTP 429 (rate limit / quota)",
  },
  {
    pattern: /\bquota\b.*\b(exceed|exhaust)/i,
    reason: "quota-exceeded",
    message: (m) => `Backend reported quota exceeded (${m})`,
  },
  {
    pattern: /insufficient[_ ]?quota/i,
    reason: "quota-exceeded",
    message: () => "Backend reported insufficient quota",
  },
];

const AUTH_RULES: IssueRule[] = [
  {
    pattern: /Authentication not implemented/i,
    reason: "auth-required",
    appliesTo: ["opencode"],
    message: () => "OpenCode reports it has no API authentication configured",
  },
  {
    pattern: /\b(?:401|403)\b[^0-9]*(unauthorized|forbidden|invalid[_ ]api[_ ]key)/i,
    reason: "auth-required",
    message: () => "Backend rejected credentials (HTTP 401/403)",
  },
  {
    pattern: /Please (?:re-?)?authenticate|authentication[_ ](?:required|failed)/i,
    reason: "auth-required",
    message: (m) => `Backend requires authentication (${m})`,
  },
  {
    pattern: /api[_ ]?key.*(?:missing|invalid|expired|not[_ ]?(?:set|configured))/i,
    reason: "auth-required",
    message: () => "Backend reports the API key is missing/invalid/expired",
  },
  {
    pattern: /token.*(?:expired|invalid|revoked)/i,
    reason: "auth-required",
    message: () => "Backend reports the auth token is expired or invalid",
  },
  {
    pattern: /please run\s+`?([a-z][a-z0-9_-]+\s+[a-z][a-z0-9_-]+)`?/i,
    reason: "auth-required",
    message: (m) => `Backend instructs the user to run a CLI command (${m})`,
  },
];

const ALL_RULES: IssueRule[] = [...QUOTA_RULES, ...AUTH_RULES];

const DEFAULT_HINTS: Record<
  BackendName,
  Record<"auth-required" | "quota-exceeded", string>
> = {
  "claude-code": {
    "auth-required":
      "Claude Code 凭证缺失或过期。请重新登录：`claude login`，或在配置/环境中设置 ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN。",
    "quota-exceeded":
      "Claude Code 配额/限流。请稍后重试，或切换 ANTHROPIC_MODEL 至有配额的模型，或检查账户用量与计划。",
  },
  codex: {
    "auth-required":
      "Codex 凭证缺失或过期。请重新登录：`codex login`，或设置 OPENAI_API_KEY 与 CODEX_MODEL_PROVIDER。",
    "quota-exceeded":
      "Codex 配额/限流。请稍后重试，或切换到有配额的模型 (`-c model=...`)，或检查 OpenAI 账户限额。",
  },
  gemini: {
    "auth-required":
      "Gemini 凭证缺失或过期。请重新登录：`gemini auth` (或 `gemini /auth`)，或设置 GEMINI_API_KEY/GOOGLE_API_KEY。",
    "quota-exceeded":
      "Gemini 配额/容量耗尽 (常见于 *-preview 模型)。请切换 GEMINI_MODEL 至有配额的稳定模型 (例如 gemini-2.5-flash)，或稍后重试。",
  },
  hermes: {
    "auth-required":
      "Hermes provider 凭证缺失或过期。请检查 `hermes config show` 中 model.provider 与 base_url，并设置对应的 HERMES_API_KEY/MINIMAX_API_KEY/ANTHROPIC_API_KEY。",
    "quota-exceeded":
      "Hermes 上游 provider 限流。请切换 HERMES_MODEL 或更换 provider，或稍后重试。",
  },
  opencode: {
    "auth-required":
      "OpenCode 未登录或未配置任何 provider 凭证。请运行 `opencode auth login` 完成交互式登录，或在 ~/.local/share/opencode/auth.json 中配置 provider。",
    "quota-exceeded":
      "OpenCode 上游 provider 限流。请通过 `opencode auth login` 切换 provider，或在 OpenCode 配置中切换 model。",
  },
};

function defaultHint(
  backend: BackendName,
  reason: "auth-required" | "quota-exceeded",
): string {
  return (
    DEFAULT_HINTS[backend]?.[reason] ??
    (reason === "auth-required"
      ? "后端要求认证，请在该后端 CLI 内完成登录或在 iota 配置中设置对应 API key。"
      : "后端报告配额或限流耗尽，请切换模型/账号或稍后重试。")
  );
}

/**
 * Inspect a chunk of backend stdout/stderr/JSON-error text and return the
 * first matching diagnostic, if any.
 */
export function detectBackendIssue(
  backend: BackendName,
  text: string,
): BackendIssue | undefined {
  if (!text) return undefined;
  for (const rule of ALL_RULES) {
    if (rule.appliesTo && !rule.appliesTo.includes(backend)) continue;
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const matched = match[0];
    return {
      code:
        rule.reason === "auth-required"
          ? ErrorCode.BACKEND_AUTH_REQUIRED
          : ErrorCode.BACKEND_QUOTA_EXCEEDED,
      reason: rule.reason,
      message: rule.message ? rule.message(matched) : matched,
      hint: rule.hint ? rule.hint(backend) : defaultHint(backend, rule.reason),
      matchedPattern: rule.pattern.source,
    };
  }
  return undefined;
}

/** Build the canonical, user-facing message that combines reason and hint. */
export function formatBackendIssueMessage(
  backend: BackendName,
  issue: BackendIssue,
): string {
  return `${backend} ${issue.reason}: ${issue.message}\n  Hint: ${issue.hint}`;
}
