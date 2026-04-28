import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

export interface SkillExecutionTool {
  name: string;
  as: string;
  arguments?: Record<string, unknown>;
}

export interface SkillExecutionPlan {
  mode: "mcp";
  server: string;
  parallel: boolean;
  tools: SkillExecutionTool[];
}

export interface SkillOutputPlan {
  template?: string;
}

export interface SkillManifest {
  name: string;
  description: string;
  content: string;
  filePath: string;
  triggers: string[];
  execution?: SkillExecutionPlan;
  output?: SkillOutputPlan;
  failurePolicy?: "report" | "fail_fast";
}

export async function loadSkills(skillRoot: string): Promise<SkillManifest[]> {
  try {
    const entries = await fs.readdir(skillRoot, { withFileTypes: true });
    const manifests: SkillManifest[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(skillRoot, entry.name, "SKILL.md");
      const content = await fs.readFile(filePath, "utf8").catch(() => null);
      if (!content) {
        console.debug(`[iota-skill] skipped ${entry.name}: SKILL.md not found`);
        continue;
      }
      const manifest = parseSkillManifest(filePath, content, entry.name);
      manifests.push(manifest);
      console.debug(
        `[iota-skill] loaded skill "${manifest.name}" from ${filePath}`,
      );
    }

    console.debug(`[iota-skill] total skills loaded: ${manifests.length}`);
    return manifests;
  } catch (err) {
    console.debug(
      `[iota-skill] skill root not found or unreadable: ${skillRoot} (${String(err)})`,
    );
    return [];
  }
}

function parseSkillManifest(
  filePath: string,
  content: string,
  fallbackName: string,
): SkillManifest {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return {
      name: fallbackName,
      description: "",
      content,
      filePath,
      triggers: [],
    };
  }

  const end = trimmed.indexOf("\n---", 3);
  if (end < 0) {
    return {
      name: fallbackName,
      description: "",
      content,
      filePath,
      triggers: [],
    };
  }

  const frontmatter = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 4).trimStart();
  const data = parseFrontmatter(frontmatter);
  const name = stringValue(data.name) || fallbackName;
  const description = stringValue(data.description) || "";

  return {
    name,
    description,
    content: body,
    filePath,
    triggers: stringArrayValue(data.triggers),
    execution: executionValue(data.execution),
    output: outputValue(data.output),
    failurePolicy: failurePolicyValue(data.failurePolicy),
  };
}

function parseFrontmatter(frontmatter: string): Record<string, unknown> {
  const parsed = yaml.load(frontmatter);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function executionValue(value: unknown): SkillExecutionPlan | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const raw = value as Record<string, unknown>;
  const mode = raw.mode === "mcp" ? "mcp" : undefined;
  const server = stringValue(raw.server);
  const tools = Array.isArray(raw.tools)
    ? raw.tools
        .map((tool) => toolValue(tool))
        .filter((tool): tool is SkillExecutionTool => Boolean(tool))
    : [];
  if (!mode || !server || tools.length === 0) return undefined;
  return {
    mode,
    server,
    parallel: raw.parallel !== false,
    tools,
  };
}

function toolValue(value: unknown): SkillExecutionTool | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const raw = value as Record<string, unknown>;
  const name = stringValue(raw.name);
  const as = stringValue(raw.as);
  if (!name || !as) return undefined;
  return {
    name,
    as,
    arguments:
      raw.arguments &&
      typeof raw.arguments === "object" &&
      !Array.isArray(raw.arguments)
        ? (raw.arguments as Record<string, unknown>)
        : undefined,
  };
}

function outputValue(value: unknown): SkillOutputPlan | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const raw = value as Record<string, unknown>;
  const template = stringValue(raw.template);
  return template ? { template } : undefined;
}

function failurePolicyValue(
  value: unknown,
): "report" | "fail_fast" | undefined {
  return value === "report" || value === "fail_fast" ? value : undefined;
}

export function buildSkillPromptSection(
  skills: SkillManifest[],
): string | undefined {
  if (skills.length === 0) return undefined;

  const lines = ["<iota_skills>"];
  for (const skill of skills) {
    lines.push(`## ${skill.name}`);
    if (skill.description) {
      lines.push(skill.description);
    }
    lines.push(skill.content.trim());
    lines.push("");
  }
  lines.push("</iota_skills>");
  return lines.join("\n");
}
