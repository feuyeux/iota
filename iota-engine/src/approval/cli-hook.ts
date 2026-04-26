import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type {
  ApprovalDecision,
  ApprovalHook,
  ApprovalRequest,
} from "./hook.js";

export class CliApprovalHook implements ApprovalHook {
  async requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    const rl = readline.createInterface({ input, output });
    try {
      const answer = await withCliTimeout(
        rl.question(
          `[${request.operationType}] ${request.description} Approve? [y/N] `,
        ),
        request.timeoutMs,
      );
      return answer.trim().toLowerCase() === "y"
        ? { decision: "approve" }
        : { decision: "deny", reason: "User denied approval" };
    } catch {
      return {
        decision: "deny",
        reason: `Approval timed out after ${request.timeoutMs}ms`,
      };
    } finally {
      rl.close();
    }
  }
}

function withCliTimeout(
  promise: Promise<string>,
  timeoutMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
