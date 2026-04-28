import { describe, expect, it } from "vitest";
import { matchExecutableSkill, runSkillViaMcp } from "./runner.js";
import type { SkillManifest } from "./loader.js";
import type { RuntimeEvent, RuntimeRequest } from "../event/types.js";

describe("SkillRunner", () => {
  const weatherSkill: SkillManifest = {
    name: "weather-summary",
    description: "Builds a weather sentence from MCP tools",
    content: "",
    filePath: "/skills/weather/SKILL.md",
    triggers: ["weather summary"],
    execution: {
      mode: "mcp",
      server: "weather-tools",
      parallel: true,
      tools: [
        { name: "weather.temperature", as: "temperature" },
        { name: "weather.condition", as: "condition" },
      ],
    },
    output: {
      template: "Weather: {{temperature}} and {{condition}}.",
    },
    failurePolicy: "report",
  };

  const request: RuntimeRequest = {
    sessionId: "session-1",
    executionId: "exec-1",
    prompt: "please create a weather summary",
    backend: "claude-code",
    workingDirectory: "/repo",
  };

  it("matches executable skills by structured triggers", () => {
    expect(matchExecutableSkill(request.prompt, [weatherSkill])?.name).toBe(
      "weather-summary",
    );
    expect(
      matchExecutableSkill("unrelated prompt", [weatherSkill]),
    ).toBeUndefined();
  });

  it("runs a non-pet MCP skill from frontmatter execution data", async () => {
    const events: RuntimeEvent[] = [];
    const runner = runSkillViaMcp(weatherSkill, request, "claude-code", {
      mcpRouter: {
        listServers: () => [{ name: "weather-tools", command: "node" }],
        callTool: async ({ toolName }: { toolName: string }) => ({
          content: [
            {
              type: "text",
              text: toolName === "weather.temperature" ? "18C" : "cloudy",
            },
          ],
          isError: false,
        }),
      } as never,
      assertFencingValid: async () => {},
      persistEvent: async (event) => {
        const persisted = { ...event, sequence: events.length + 1 };
        events.push(persisted);
        return persisted;
      },
    });

    let result = await runner.next();
    while (!result.done) {
      result = await runner.next();
    }

    expect(result.value.status).toBe("completed");
    expect(result.value.output).toBe("Weather: 18C and cloudy.");
    expect(events.filter((event) => event.type === "tool_call")).toHaveLength(
      2,
    );
    expect(events.filter((event) => event.type === "tool_result")).toHaveLength(
      2,
    );
    expect(events.at(-1)).toMatchObject({
      type: "output",
      data: { content: "Weather: 18C and cloudy." },
    });
  });
});
