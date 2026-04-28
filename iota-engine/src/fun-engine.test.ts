import path from "node:path";
import { describe, expect, it } from "vitest";
import { IotaFunEngine } from "./fun-engine.js";

describe("IotaFunEngine", () => {
  const engine = new IotaFunEngine(path.resolve(__dirname));

  it("builds go plan against iota-fun/go", () => {
    const plan = engine.buildPlan("go");

    expect(plan.compileCommand).toBe("go");
    expect(plan.compileArgs).toContain("build");
    expect(plan.command).toContain(path.join(".iota", "iota-fun"));
    expect(plan.command).toContain("iota-fun-go-");
    expect(plan.args).toEqual([]);
    expect(plan.cwd).toContain(path.join("iota-fun", "go"));
  });

  it("builds python inline plan", () => {
    const plan = engine.buildPlan("python");

    expect(plan.command).toBe("python");
    expect(plan.args[0]).toBe("-c");
    expect(plan.args[1]).toContain("random_number.py");
  });

  it("builds typescript plan without eval", () => {
    const plan = engine.buildPlan("typescript");

    expect(plan.command).toBe("node");
    expect(plan.args).toHaveLength(1);
    expect(plan.args[0]).toContain(
      path.join("iota-fun", "typescript", "runner.js"),
    );
    expect(plan.cwd).toContain(path.join("iota-fun", "typescript"));
  });

  it("builds java compile and run plan", () => {
    const plan = engine.buildPlan("java");

    expect(plan.compileCommand).toBe("javac");
    expect(plan.compileArgs).toContain("-d");
    expect(plan.command).toBe("java");
    expect(plan.args).toContain("RandomAnimalRunner");
  });

  it("builds zig as cached compiled binary", () => {
    const plan = engine.buildPlan("zig");

    expect(plan.compileCommand).toBe("zig");
    expect(plan.compileArgs).toContain("build-exe");
    expect(plan.command).toContain(path.join(".iota", "iota-fun"));
    expect(plan.command).toContain("iota-fun-zig-");
    expect(plan.args).toEqual([]);
  });

  it("builds rust as cached compiled binary", () => {
    const plan = engine.buildPlan("rust");

    expect(plan.compileCommand).toBe("rustc");
    expect(plan.command).toContain("iota-fun-rust-");
    expect(plan.args).toEqual([]);
  });

  it("builds cpp as cached compiled binary", () => {
    const plan = engine.buildPlan("cpp");

    expect(plan.compileCommand).toBe("g++");
    expect(plan.command).toContain("iota-fun-cpp-");
    expect(plan.args).toEqual([]);
  });
});
