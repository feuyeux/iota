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

    const episodicHints = [
      "回顾",
      "复盘",
      "回看",
      "recap",
      "summarize our",
      "summarize the conversation",
      "之前的对话",
      "前面的对话",
    ];
    if (episodicHints.some((hint) => lower.includes(hint))) {
      return backend === "claude-code"
        ? "conversation_context"
        : backend === "codex"
          ? "session_history"
          : backend === "gemini"
            ? "interaction_log"
            : "dialogue_memory";
    }

    const semanticProfileHints = [
      "my name is",
      "i am ",
      "i'm ",
      "prefer",
      "preference",
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
    if (semanticProfileHints.some((hint) => lower.includes(hint))) {
      return backend === "claude-code"
        ? "user_preferences"
        : backend === "codex"
          ? "codebase_facts"
          : backend === "gemini"
            ? "entity_knowledge"
            : "profile_memory";
    }

    const strategicHints = [
      "decided",
      "plan",
      "architecture",
      "goal",
      "strategy",
      "目标",
      "战略",
      "规划",
      "架构",
      "方向",
      "决定",
    ];
    if (strategicHints.some((hint) => lower.includes(hint))) {
      return backend === "claude-code"
        ? "project_context"
        : backend === "codex"
          ? "task_planning"
          : backend === "gemini"
            ? "goal_tracking"
            : "intention_memory";
    }

    const proceduralHints = [
      "use ",
      "run ",
      "command",
      "step",
      "how to",
      "步骤",
      "流程",
      "如何",
      "怎样",
      "怎么",
      "方法",
      "总结",
    ];
    if (proceduralHints.some((hint) => lower.includes(hint))) {
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
    const preferenceHints = [
      "prefer",
      "preference",
      "喜欢",
      "偏好",
      "习惯",
      "风格",
      "用中文",
      "少废话",
    ];
    if (preferenceHints.some((hint) => lower.includes(hint))) {
      return "preference";
    }

    const identityHints = [
      "my name is",
      "i am ",
      "i'm ",
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
    if (identityHints.some((hint) => lower.includes(hint))) {
      return "identity";
    }

    return fallback;
  }
}
