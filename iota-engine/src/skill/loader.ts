import fs from "node:fs/promises";
import path from "node:path";

export interface SkillManifest {
  name: string;
  description: string;
  content: string;
  filePath: string;
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
      console.debug(`[iota-skill] loaded skill "${manifest.name}" from ${filePath}`);
    }

    console.debug(`[iota-skill] total skills loaded: ${manifests.length}`);
    return manifests;
  } catch (err) {
    console.debug(`[iota-skill] skill root not found or unreadable: ${skillRoot} (${String(err)})`);
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
    };
  }

  const end = trimmed.indexOf("\n---", 3);
  if (end < 0) {
    return {
      name: fallbackName,
      description: "",
      content,
      filePath,
    };
  }

  const frontmatter = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 4).trimStart();
  let name = fallbackName;
  let description = "";

  for (const line of frontmatter.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === "name" && value) name = value;
    if (key === "description" && value) description = value;
  }

  return {
    name,
    description,
    content: body,
    filePath,
  };
}

export function buildSkillPromptSection(skills: SkillManifest[]): string | undefined {
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
