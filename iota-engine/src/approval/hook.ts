import type { BackendName } from "../event/types.js";

export interface ApprovalRequest {
  sessionId: string;
  executionId: string;
  backend: BackendName;
  operationType:
    | "shell"
    | "fileOutside"
    | "network"
    | "container"
    | "mcpExternal"
    | "privilegeEscalation";
  description: string;
  details: Record<string, unknown>;
  timeoutMs: number;
}

export interface ApprovalDecision {
  decision: "approve" | "deny";
  reason?: string;
  rememberForSession?: boolean;
}

export interface ApprovalHook {
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
}

export class AutoApprovalHook implements ApprovalHook {
  async requestApproval(): Promise<ApprovalDecision> {
    return { decision: "approve" };
  }
}
