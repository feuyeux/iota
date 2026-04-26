import type { RuntimeResponse } from "../event/types.js";
import type { MemoryBlock } from "../event/types.js";

/** Regex patterns for extracting file paths from output */
const FILE_PATH_PATTERN =
  /(?:^|\s|['"`])([./\\]?(?:src|lib|test|tests|dist|packages|node_modules)\/[\w./-]+\.\w{1,10})(?:\s|['"`]|:|$)/gm;
const RELATIVE_PATH_PATTERN =
  /(?:^|\s|['"`])(\.{1,2}\/[\w./-]+\.\w{1,10})(?:\s|['"`]|:|$)/gm;

/** Regex for fenced code blocks */
const CODE_BLOCK_PATTERN = /```[\w]*\n([\s\S]*?)```/g;

/** Regex for common error patterns */
const ERROR_PATTERNS = [
  /(?:Error|ERROR|error):\s*(.+)/,
  /(?:FAIL|FAILED|failed)(?:ED)?[:\s]+(.+)/,
  /(?:Exception|exception):\s*(.+)/,
  /(?:panic|PANIC):\s*(.+)/,
];

export interface ExtractedMetadata {
  [key: string]: unknown;
  backend: string;
  executionId: string;
  taskSummary: string;
  involvedFiles: string[];
  codeKnowledge: string[];
  failureReason: string | null;
  importance: number;
}

export function extractMemory(response: RuntimeResponse): MemoryBlock | null {
  if (response.output.length < 200) {
    return null;
  }

  const output = response.output;

  // Task summary: first meaningful paragraph (non-empty, non-code line)
  const taskSummary = extractTaskSummary(output);

  // Involved files
  const involvedFiles = extractFilePaths(output);

  // Code knowledge: extract code blocks
  const codeKnowledge = extractCodeBlocks(output);

  // Failure reason
  const failureReason =
    response.status === "failed"
      ? extractFailureReason(
          output,
          typeof response.error === "string"
            ? response.error
            : response.error?.message,
        )
      : null;

  // Importance score 0-1
  const importance = computeImportance(
    output,
    codeKnowledge,
    involvedFiles,
    failureReason,
  );

  const metadata: ExtractedMetadata = {
    backend: response.backend,
    executionId: response.executionId,
    taskSummary,
    involvedFiles,
    codeKnowledge,
    failureReason,
    importance,
  };

  return {
    id: `mem_${response.executionId}`,
    type: classifyMemory({ codeKnowledge, failureReason }),
    content: output.slice(0, 4_000),
    metadata,
  };
}

function classifyMemory(input: {
  codeKnowledge: string[];
  failureReason: string | null;
}): MemoryBlock["type"] {
  if (input.codeKnowledge.length > 0) {
    // Contains executable code snippets → reusable procedural knowledge
    return "procedural";
  }
  // Specific execution episode (success or failure)
  return "episodic";
}

function extractTaskSummary(output: string): string {
  const lines = output.split("\n");
  const paragraphs: string[] = [];
  let current = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (current) {
        paragraphs.push(current.trim());
        current = "";
      }
    } else if (!trimmed.startsWith("```")) {
      current += " " + trimmed;
    }
  }
  if (current) paragraphs.push(current.trim());

  // Return first paragraph that's at least 20 chars and doesn't look like a path/code
  for (const p of paragraphs) {
    if (p.length >= 20 && !p.startsWith("/") && !p.startsWith("{")) {
      return p.slice(0, 500);
    }
  }
  return paragraphs[0]?.slice(0, 500) ?? "";
}

function extractFilePaths(output: string): string[] {
  const paths = new Set<string>();

  for (const pattern of [FILE_PATH_PATTERN, RELATIVE_PATH_PATTERN]) {
    let match: RegExpExecArray | null;
    // Reset lastIndex for reuse
    pattern.lastIndex = 0;
    while ((match = pattern.exec(output)) !== null) {
      paths.add(match[1]);
    }
  }

  return [...paths];
}

function extractCodeBlocks(output: string): string[] {
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  CODE_BLOCK_PATTERN.lastIndex = 0;
  while ((match = CODE_BLOCK_PATTERN.exec(output)) !== null) {
    const block = match[1].trim();
    if (block.length > 0) {
      blocks.push(block.slice(0, 1_000));
    }
  }
  return blocks;
}

function extractFailureReason(output: string, error?: string): string {
  if (error) return error.slice(0, 500);

  for (const pattern of ERROR_PATTERNS) {
    const match = pattern.exec(output);
    if (match) return match[1].trim().slice(0, 500);
  }

  return "Unknown failure";
}

function computeImportance(
  output: string,
  codeBlocks: string[],
  files: string[],
  failureReason: string | null,
): number {
  let score = 0;

  // Length contribution (longer = more important, up to 0.3)
  score += Math.min(output.length / 5000, 0.3);

  // Has code blocks (up to 0.25)
  score += Math.min(codeBlocks.length * 0.1, 0.25);

  // File modifications (up to 0.25)
  score += Math.min(files.length * 0.05, 0.25);

  // Failure info is valuable
  if (failureReason) score += 0.2;

  return Math.min(score, 1);
}
