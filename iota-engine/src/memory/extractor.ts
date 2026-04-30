import type { BackendName } from "../event/types.js";
import type { BackendMemoryEvent, StoredMemory } from "./types.js";

export interface MemoryExtractionInput {
  backend: BackendName;
  prompt: string;
  output: string;
}

export interface MemoryExtractionResult {
  content: string;
  nativeType: BackendMemoryEvent["nativeType"];
  semanticFacet?: StoredMemory["facet"];
}

/**
 * Check if text matches any of the given regex patterns or includes any of
 * the given literal substrings (used for Chinese terms where \b is unusable).
 */
function matchesAny(
  text: string,
  regexPatterns: RegExp[],
  includePatterns: string[] = [],
): boolean {
  return (
    regexPatterns.some((re) => re.test(text)) ||
    includePatterns.some((p) => text.includes(p))
  );
}

export class MemoryExtractor {
  extract(input: MemoryExtractionInput): MemoryExtractionResult | null {
    const content = this.extractMemoryContent(input.prompt, input.output);
    if (!content) return null;
    return {
      content,
      nativeType: this.resolveNativeMemoryType(input.backend, input.prompt),
      semanticFacet: this.resolveSemanticFacet(input.prompt),
    };
  }

  resolveBackendMemoryEvent(
    _backend: BackendName,
    _nativeType: string,
    content: string,
  ): { semanticFacet?: StoredMemory["facet"] } {
    return {
      semanticFacet: this.resolveSemanticFacet(content),
    };
  }

  private extractMemoryContent(prompt: string, output: string): string | null {
    const promptText = prompt.trim();
    const outputText = output.trim();
    if (!promptText && !outputText) {
      return null;
    }

    const responseSummary = outputText.slice(0, 800);
    const combined = promptText
      ? `User request: ${promptText}\nResult: ${responseSummary}`
      : responseSummary;

    return combined.length >= 20 ? combined.slice(0, 2000) : null;
  }

  private resolveNativeMemoryType(
    backend: BackendName,
    content: string,
  ): BackendMemoryEvent["nativeType"] {
    const lower = content.toLowerCase();

    const episodicRegex = [
      /\brecap\b/,
      /\bsummarize our\b/,
      /\bsummarize the conversation\b/,
    ];
    const episodicIncludes = [
      "回顾",
      "复盘",
      "回看",
      "之前的对话",
      "前面的对话",
    ];
    if (matchesAny(lower, episodicRegex, episodicIncludes)) {
      return backend === "claude-code"
        ? "conversation_context"
        : backend === "codex"
          ? "session_history"
          : backend === "gemini"
            ? "interaction_log"
            : "dialogue_memory";
    }

    const semanticProfileRegex = [
      /\bmy name is\b/,
      /\bi am\s/,
      /\bi'm\s/,
      /\bprefer\b/,
      /\bpreference\b/,
    ];
    const semanticProfileIncludes = [
      "喜欢",
      "偏好",
      "习惯",
      "风格",
      "我叫",
      "我的名字",
      "我是",
      "身份信息",
      "姓名",
      "兼任",
      "职位",
      "产品经理",
      "架构师",
      "工程师",
    ];
    if (matchesAny(lower, semanticProfileRegex, semanticProfileIncludes)) {
      return backend === "claude-code"
        ? "user_preferences"
        : backend === "codex"
          ? "codebase_facts"
          : backend === "gemini"
            ? "entity_knowledge"
            : "profile_memory";
    }

    const strategicRegex = [
      /\bdecided\b/,
      /\bplan\b/,
      /\barchitecture\b/,
      /\bgoal\b/,
      /\bstrategy\b/,
    ];
    const strategicIncludes = [
      "目标",
      "战略",
      "规划",
      "架构",
      "方向",
      "决定",
    ];
    if (matchesAny(lower, strategicRegex, strategicIncludes)) {
      return backend === "claude-code"
        ? "project_context"
        : backend === "codex"
          ? "task_planning"
          : backend === "gemini"
            ? "goal_tracking"
            : "intention_memory";
    }

    const proceduralRegex = [
      /\buse\s/,
      /\brun\s/,
      /\bcommand\b/,
      /\bstep\b/,
      /\bhow to\b/,
    ];
    const proceduralIncludes = [
      "步骤",
      "流程",
      "如何",
      "怎样",
      "怎么",
      "方法",
      "总结",
    ];
    if (matchesAny(lower, proceduralRegex, proceduralIncludes)) {
      return backend === "claude-code"
        ? "code_context"
        : backend === "codex"
          ? "tool_usage"
          : backend === "gemini"
            ? "execution_patterns"
            : "skill_memory";
    }

    return backend === "claude-code"
      ? "conversation_context"
      : backend === "codex"
        ? "session_history"
        : backend === "gemini"
          ? "interaction_log"
          : "dialogue_memory";
  }

  private resolveSemanticFacet(
    content: string,
    fallback: StoredMemory["facet"] = "domain",
  ): StoredMemory["facet"] {
    const lower = content.toLowerCase();
    const preferenceRegex = [/\bprefer\b/, /\bpreference\b/];
    const preferenceIncludes = [
      "喜欢",
      "偏好",
      "习惯",
      "风格",
      "用中文",
      "少废话",
    ];
    if (matchesAny(lower, preferenceRegex, preferenceIncludes)) {
      return "preference";
    }

    const identityRegex = [/\bmy name is\b/, /\bi am\s/, /\bi'm\s/];
    const identityIncludes = [
      "我叫",
      "我的名字",
      "我是",
      "身份信息",
      "姓名",
      "兼任",
      "职位",
      "产品经理",
      "架构师",
      "工程师",
    ];
    if (matchesAny(lower, identityRegex, identityIncludes)) {
      return "identity";
    }

    return fallback;
  }
}
