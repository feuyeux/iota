import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ErrorCode, IotaError } from "./error/codes.js";

export type FunLanguage =
  | "python"
  | "typescript"
  | "go"
  | "rust"
  | "zig"
  | "java"
  | "cpp";

export interface FunExecutionRequest {
  language: FunLanguage;
  timeoutMs?: number;
}

export interface FunExecutionResult {
  language: FunLanguage;
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  value: string;
}

interface ExecutionPlan {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  compileCommand?: string;
  compileArgs?: string[];
  compileCwd?: string;
  compileEnv?: NodeJS.ProcessEnv;
  postCompileCommand?: string;
  postCompileArgs?: string[];
  postCompileEnv?: NodeJS.ProcessEnv;
  cleanup?: () => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class IotaFunEngine {
  private readonly engineRoot: string;
  private readonly funRoot: string;

  constructor(srcDir: string) {
    this.engineRoot = resolveEngineRoot(srcDir);
    this.funRoot = path.resolve(
      this.engineRoot,
      "..",
      "iota-skill",
      "pet-generator",
      "iota-fun",
    );
  }

  buildPlan(language: FunLanguage): ExecutionPlan {
    switch (language) {
      case "python":
        return {
          command: "python",
          args: ["-c", this.pythonScript()],
          cwd: this.engineRoot,
        };
      case "typescript":
        return {
          command: "node",
          args: [this.typescriptRunnerPath()],
          cwd: path.join(this.funRoot, "typescript"),
        };
      case "go":
        return this.goPlan();
      case "rust":
        return this.rustPlan();
      case "zig":
        return this.zigPlan();
      case "java":
        return this.javaPlan();
      case "cpp":
        return this.cppPlan();
      default:
        return assertNever(language);
    }
  }

  async execute(request: FunExecutionRequest): Promise<FunExecutionResult> {
    const plan = this.buildPlan(request.language);

    try {
      if (plan.compileCommand) {
        await this.run(
          plan.compileCommand,
          plan.compileArgs ?? [],
          plan.compileCwd ?? plan.cwd,
          request,
          plan.compileEnv ?? plan.env,
        );
      }

      let result = await this.run(
        plan.command,
        plan.args,
        plan.cwd,
        request,
        plan.env,
      );

      if (plan.postCompileCommand) {
        result = await this.run(
          plan.postCompileCommand,
          plan.postCompileArgs ?? [],
          plan.cwd,
          request,
          plan.postCompileEnv ?? plan.env,
        );
      }

      return {
        language: request.language,
        command: plan.postCompileCommand ?? plan.command,
        args: plan.postCompileArgs ?? plan.args,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        value: extractValue(result.stdout),
      };
    } finally {
      plan.cleanup?.();
    }
  }

  private run(
    command: string,
    args: string[],
    cwd: string,
    request: FunExecutionRequest,
    env?: NodeJS.ProcessEnv,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(
          new IotaError({
            code: ErrorCode.BACKEND_TIMEOUT,
            message: `Fun execution timed out for ${request.language}`,
            details: { language: request.language, timeoutMs },
            retryable: true,
          }),
        );
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(
          new IotaError({
            code: ErrorCode.BACKEND_UNAVAILABLE,
            message: `Failed to start runtime for ${request.language}: ${error.message}`,
            details: { language: request.language, command },
          }),
        );
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        const exitCode = code ?? 0;
        if (exitCode !== 0) {
          reject(
            new IotaError({
              code: ErrorCode.EXECUTION_FAILED,
              message: `Fun execution failed for ${request.language}`,
              details: {
                language: request.language,
                command,
                args,
                exitCode,
                stderr: stderr.trim(),
              },
            }),
          );
          return;
        }

        resolve({ stdout, stderr, exitCode });
      });
    });
  }

  private pythonScript(): string {
    const file = path
      .join(this.funRoot, "python", "random_number.py")
      .replaceAll("\\", "\\\\");
    return [
      "import importlib.util",
      `spec = importlib.util.spec_from_file_location('random_number', r'${file}')`,
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "print(module.random_number())",
    ].join("; ");
  }

  private typescriptRunnerPath(): string {
    return path.join(this.funRoot, "typescript", "runner.js");
  }

  private goPlan(): ExecutionPlan {
    const cwd = path.join(this.funRoot, "go");
    const sources = [
      path.join(cwd, "random_shape.go"),
      path.join(cwd, "runner.go"),
    ];
    for (const source of sources) this.ensureFile(source);
    const binary = cachedBinaryPath("go", sources);
    if (fs.existsSync(binary)) {
      return { command: binary, args: [], cwd };
    }
    return {
      compileCommand: "go",
      compileArgs: ["build", "-o", binary, "random_shape.go", "runner.go"],
      compileCwd: cwd,
      command: binary,
      args: [],
      cwd,
    };
  }

  private rustPlan(): ExecutionPlan {
    const cwd = path.join(this.funRoot, "rust");
    const sources = [
      path.join(cwd, "runner.rs"),
      path.join(cwd, "random_material.rs"),
    ];
    for (const source of sources) this.ensureFile(source);
    const binary = cachedBinaryPath("rust", sources);
    if (fs.existsSync(binary)) {
      return {
        command: binary,
        args: [],
        cwd,
      };
    }
    return {
      compileCommand: "rustc",
      compileArgs: ["runner.rs", "-o", binary],
      compileCwd: cwd,
      command: binary,
      args: [],
      cwd,
    };
  }

  private zigPlan(): ExecutionPlan {
    const cwd = path.join(this.funRoot, "zig");
    const sources = [
      path.join(cwd, "runner.zig"),
      path.join(cwd, "random_size.zig"),
    ];
    for (const source of sources) this.ensureFile(source);
    const binary = cachedBinaryPath("zig", sources);
    if (fs.existsSync(binary)) {
      return { command: binary, args: [], cwd };
    }
    return {
      compileCommand: "zig",
      compileArgs: [
        "build-exe",
        "runner.zig",
        "-O",
        "ReleaseFast",
        // Zig 0.16 requires explicit libc linkage for the extern write call in runner.zig.
        "-lc",
        `-femit-bin=${binary}`,
      ],
      compileCwd: cwd,
      command: binary,
      args: [],
      cwd,
    };
  }

  private javaPlan(): ExecutionPlan {
    const cwd = path.join(this.funRoot, "java");
    const sources = [
      path.join(cwd, "RandomAnimal.java"),
      path.join(cwd, "RandomAnimalRunner.java"),
    ];
    for (const source of sources) this.ensureFile(source);
    const classDir = cachedClassDirPath("java", sources);
    const runnerClass = path.join(classDir, "RandomAnimalRunner.class");
    if (fs.existsSync(runnerClass)) {
      return {
        command: "java",
        args: [
          "-Dfile.encoding=UTF-8",
          "-Dsun.stdout.encoding=UTF-8",
          "-cp",
          classDir,
          "RandomAnimalRunner",
        ],
        cwd,
      };
    }
    fs.mkdirSync(classDir, { recursive: true });
    return {
      compileCommand: "javac",
      compileArgs: [
        "-encoding",
        "UTF-8",
        "-d",
        classDir,
        "RandomAnimal.java",
        "RandomAnimalRunner.java",
      ],
      compileCwd: cwd,
      command: "java",
      args: [
        "-Dfile.encoding=UTF-8",
        "-Dsun.stdout.encoding=UTF-8",
        "-cp",
        classDir,
        "RandomAnimalRunner",
      ],
      cwd,
    };
  }

  private cppPlan(): ExecutionPlan {
    const cwd = path.join(this.funRoot, "cpp");
    const env = this.buildCppEnv();
    const sources = [
      path.join(cwd, "random_action.cpp"),
      path.join(cwd, "random_action_runner.cpp"),
    ];
    for (const source of sources) this.ensureFile(source);
    const binary = cachedBinaryPath("cpp", sources);
    if (fs.existsSync(binary)) {
      return {
        command: binary,
        args: [],
        cwd,
        env,
      };
    }
    return {
      compileCommand: this.cppCompilerCommand(),
      compileArgs: this.cppCompileArgs(binary),
      compileCwd: cwd,
      compileEnv: env,
      command: binary,
      args: [],
      cwd,
      env,
    };
  }

  private cppCompilerCommand(): string {
    return process.platform === "win32" ? "zig" : "g++";
  }

  private cppCompileArgs(binary: string): string[] {
    if (process.platform === "win32") {
      return ["c++", "random_action_runner.cpp", "-std=c++17", "-o", binary];
    }
    return ["random_action_runner.cpp", "-std=c++17", "-o", binary];
  }

  private ensureFile(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      throw new IotaError({
        code: ErrorCode.CONFIG_INVALID,
        message: `Fun source file not found: ${filePath}`,
        details: { filePath },
      });
    }
  }

  private buildCppEnv(): NodeJS.ProcessEnv {
    if (process.platform !== "win32") {
      return { ...process.env };
    }

    const mingwBin = "C:\\ProgramData\\mingw64\\mingw64\\bin";
    const pathValue = process.env.PATH ?? "";
    const parts = pathValue.split(path.delimiter);
    if (!parts.includes(mingwBin)) {
      parts.unshift(mingwBin);
    }

    return {
      ...process.env,
      PATH: parts.join(path.delimiter),
    };
  }
}

function resolveEngineRoot(srcDir: string): string {
  const resolved = path.resolve(srcDir);
  const base = path.basename(resolved);
  if (base === "src" || base === "dist") {
    return path.dirname(resolved);
  }

  const parent = path.dirname(resolved);
  const parentBase = path.basename(parent);
  if (base === "mcp" && (parentBase === "src" || parentBase === "dist")) {
    return path.dirname(parent);
  }

  return resolved;
}

function cachedBinaryPath(language: string, sources: string[]): string {
  return cachedPath(
    language,
    sources,
    process.platform === "win32" ? ".exe" : "",
  );
}

function cachedClassDirPath(language: string, sources: string[]): string {
  return cachedPath(language, sources, "-classes");
}

function cachedPath(
  language: string,
  sources: string[],
  suffix: string,
): string {
  const hash = crypto.createHash("sha256");
  hash.update("v3");
  hash.update(process.platform);
  hash.update(process.arch);
  for (const source of sources) {
    const stat = fs.statSync(source);
    hash.update(source);
    hash.update(String(stat.mtimeMs));
    hash.update(String(stat.size));
  }
  const cacheDir = path.join(os.homedir(), ".iota", "iota-fun");
  fs.mkdirSync(cacheDir, { recursive: true });
  return path.join(
    cacheDir,
    `iota-fun-${language}-${hash.digest("hex").slice(0, 16)}${suffix}`,
  );
}

function extractValue(stdout: string): string {
  const value = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!value) {
    throw new IotaError({
      code: ErrorCode.EXECUTION_FAILED,
      message: "Fun execution produced no stdout value",
    });
  }

  return value;
}

function assertNever(value: never): never {
  throw new IotaError({
    code: ErrorCode.CONFIG_INVALID,
    message: `Unsupported fun language: ${String(value)}`,
  });
}
