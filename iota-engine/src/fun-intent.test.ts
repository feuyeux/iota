import { describe, expect, it } from "vitest";
import { detectFunIntent } from "./fun-intent.js";

describe("detectFunIntent", () => {
  it("detects python random number prompts", () => {
    expect(detectFunIntent("请用 python 随机生成 1-100 的数字")?.language).toBe(
      "python",
    );
  });

  it("detects cpp random action prompts", () => {
    expect(detectFunIntent("请用 c++ 随机生成一个动作")?.language).toBe(
      "cpp",
    );
  });

  it("returns null for normal prompts", () => {
    expect(detectFunIntent("帮我总结一下这个模块")).toBeNull();
  });
});
