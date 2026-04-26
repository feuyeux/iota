import fs from "node:fs";
import path from "node:path";
import type { BackendName } from "../event/types.js";

export interface AuditEntry {
  timestamp: number;
  sessionId: string;
  executionId: string;
  backend: BackendName;
  action:
    | "execution_start"
    | "execution_finish"
    | "tool_call"
    | "approval_request"
    | "approval_decision"
    | "backend_switch"
    | "error";
  result: "success" | "failure" | "denied";
  details: Record<string, unknown>;
}

export class AuditLogger {
  private dirEnsured = false;

  constructor(
    private readonly auditPath: string,
    private readonly sink?: {
      appendAuditEntry(entry: AuditEntry): Promise<void>;
    },
  ) {}

  async append(entry: AuditEntry): Promise<void> {
    if (!this.dirEnsured) {
      await fs.promises.mkdir(path.dirname(this.auditPath), {
        recursive: true,
      });
      this.dirEnsured = true;
    }
    await fs.promises.appendFile(
      this.auditPath,
      `${JSON.stringify(entry)}\n`,
      "utf8",
    );
    await this.sink?.appendAuditEntry(entry);
  }
}
