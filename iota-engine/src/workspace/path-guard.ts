import path from "node:path";
import { ErrorCode, IotaError } from "../error/codes.js";

export interface PathGuardResult {
  absolutePath: string;
  insideRoot: boolean;
}

export function checkWorkspacePath(
  workingDirectory: string,
  candidatePath: string,
): PathGuardResult {
  const root = path.resolve(workingDirectory);
  const absolutePath = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(root, candidatePath);
  const relative = path.relative(root, absolutePath);
  const insideRoot =
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative));
  return { absolutePath, insideRoot };
}

export function assertWorkspacePath(
  workingDirectory: string,
  candidatePath: string,
): string {
  const result = checkWorkspacePath(workingDirectory, candidatePath);
  if (!result.insideRoot) {
    throw new IotaError({
      code: ErrorCode.WORKSPACE_OUTSIDE_ROOT,
      message: `Path is outside workspace root: ${candidatePath}`,
      details: { workingDirectory, absolutePath: result.absolutePath },
    });
  }
  return result.absolutePath;
}
