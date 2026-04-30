import { describe, expect, it } from "vitest";
import { ErrorCode } from "../error/codes.js";
import {
  detectBackendIssue,
  formatBackendIssueMessage,
} from "./error-hints.js";

describe("backend error-hints", () => {
  it("returns undefined for unrelated text", () => {
    expect(detectBackendIssue("gemini", "")).toBeUndefined();
    expect(
      detectBackendIssue("gemini", "stream-json: ok ping"),
    ).toBeUndefined();
  });

  describe("quota detection", () => {
    it("detects gemini MODEL_CAPACITY_EXHAUSTED with actionable hint", () => {
      const stderr = `Attempt 1 failed with status 429. Retrying with backoff...
{"error":{"code":429,"message":"No capacity","reason":"rateLimitExceeded","status":"RESOURCE_EXHAUSTED","details":[{"reason":"MODEL_CAPACITY_EXHAUSTED"}]}}`;
      const issue = detectBackendIssue("gemini", stderr);
      expect(issue).toBeDefined();
      expect(issue?.code).toBe(ErrorCode.BACKEND_QUOTA_EXCEEDED);
      expect(issue?.reason).toBe("quota-exceeded");
      expect(issue?.hint).toMatch(/GEMINI_MODEL|gemini-2\.5-flash/);
    });

    it("detects 429 quota across backends", () => {
      const text = "HTTP 429 Too Many Requests: rate limit exceeded";
      expect(detectBackendIssue("codex", text)?.code).toBe(
        ErrorCode.BACKEND_QUOTA_EXCEEDED,
      );
      expect(detectBackendIssue("claude-code", text)?.code).toBe(
        ErrorCode.BACKEND_QUOTA_EXCEEDED,
      );
    });

    it("detects insufficient_quota", () => {
      const issue = detectBackendIssue(
        "codex",
        "openai api error: insufficient_quota",
      );
      expect(issue?.reason).toBe("quota-exceeded");
      expect(issue?.hint).toMatch(/OPENAI_API_KEY|配额|计划/);
    });
  });

  describe("auth detection", () => {
    it("detects opencode 'Authentication not implemented'", () => {
      const text =
        '{"jsonrpc":"2.0","id":"auth-1","error":{"code":-32603,"message":"Internal error","data":{"details":"Authentication not implemented"}}}';
      const issue = detectBackendIssue("opencode", text);
      expect(issue?.code).toBe(ErrorCode.BACKEND_AUTH_REQUIRED);
      expect(issue?.hint).toMatch(/opencode auth login/);
    });

    it("opencode-specific patterns do not match other backends", () => {
      const text =
        '{"error":{"data":{"details":"Authentication not implemented"}}}';
      expect(detectBackendIssue("claude-code", text)).toBeUndefined();
    });

    it("detects 401 unauthorized", () => {
      const issue = detectBackendIssue(
        "claude-code",
        "401 Unauthorized: invalid_api_key",
      );
      expect(issue?.code).toBe(ErrorCode.BACKEND_AUTH_REQUIRED);
      expect(issue?.hint).toMatch(/claude login|ANTHROPIC_API_KEY/);
    });

    it("detects expired tokens", () => {
      const issue = detectBackendIssue(
        "gemini",
        "Auth token expired, please re-authenticate",
      );
      expect(issue?.reason).toBe("auth-required");
      expect(issue?.hint).toMatch(/gemini auth|GEMINI_API_KEY/);
    });

    it("detects please run <cli> auth", () => {
      const issue = detectBackendIssue(
        "hermes",
        "please run `hermes login` to continue",
      );
      expect(issue?.reason).toBe("auth-required");
    });
  });

  describe("formatBackendIssueMessage", () => {
    it("produces reason + hint message", () => {
      const issue = detectBackendIssue(
        "gemini",
        "RESOURCE_EXHAUSTED: capacity",
      )!;
      const msg = formatBackendIssueMessage("gemini", issue);
      expect(msg).toContain("gemini quota-exceeded");
      expect(msg).toContain("Hint:");
      expect(msg).toContain("GEMINI_MODEL");
    });
  });

  it("does not match benign words like '429ms latency'", () => {
    expect(
      detectBackendIssue("gemini", "request finished in 429ms"),
    ).toBeUndefined();
  });
});
