import type { FunLanguage } from "./fun-engine.js";

export interface FunIntent {
  language: FunLanguage;
}

const RULES: Array<{ language: FunLanguage; patterns: RegExp[] }> = [
  {
    language: "python",
    patterns: [/\bpython\b/i, /随机.*(1\s*[-~]\s*100|1\s*到\s*100)/i],
  },
  { language: "typescript", patterns: [/\btypescript\b/i, /随机.*颜色/i] },
  { language: "go", patterns: [/\bgo\b/i, /随机.*形状/i] },
  { language: "rust", patterns: [/\brust\b/i, /随机.*材质/i] },
  { language: "zig", patterns: [/\bzig\b/i, /随机.*尺寸/i] },
  { language: "java", patterns: [/\bjava\b/i, /随机.*动物/i] },
  { language: "cpp", patterns: [/(c\+\+|\bcpp\b)/i, /随机.*动作/i] },
];

export function detectFunIntent(prompt: string): FunIntent | null {
  const normalized = prompt.trim();
  for (const rule of RULES) {
    if (rule.patterns.every((pattern) => pattern.test(normalized))) {
      return { language: rule.language };
    }
  }
  return null;
}
