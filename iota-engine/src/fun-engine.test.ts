import path from "node:path";
import { describe, expect, it } from "vitest";
import { IotaFunEngine } from "./fun-engine.js";

describe("IotaFunEngine", () => {
  const engine = new IotaFunEngine(path.resolve(__dirname));

  it("builds go plan against iota-fun/go", () => {
    const plan = engine.buildPlan("go");

    expect(plan.command).toBe("go");
    expect(plan.args).toEqual(["run", "random_shape.go", "runner.go"]);
    expect(plan.cwd).toContain(path.join("iota-fun", "go"));
  });

  it("builds python inline plan", () => {
    const plan = engine.buildPlan("python");

    expect(plan.command).toBe("python");
    expect(plan.args[0]).toBe("-c");
    expect(plan.args[1]).toContain("random_number.py");
  });

  it("builds java compile and run plan", () => {
    const plan = engine.buildPlan("java");

    expect(plan.command).toBe("javac");
    expect(plan.postCompileCommand).toBe("java");
    expect(plan.postCompileArgs).toEqual(["RandomAnimalRunner"]);
  });
});
