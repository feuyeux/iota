import { spawn } from "node:child_process";
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
    this.engineRoot = path.resolve(srcDir, "..");
    this.funRoot = path.resolve(this.engineRoot, "..", "iota-fun");
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
          args: ["-e", this.typescriptScript()],
          cwd: this.engineRoot,
        };
      case "go":
        return {
          command: "go",
          args: ["run", "random_shape.go", "runner.go"],
          cwd: path.join(this.funRoot, "go"),
        };
      case "rust":
        return this.rustPlan();
      case "zig":
        return {
          command: "zig",
          args: ["run", "runner.zig"],
          cwd: path.join(this.funRoot, "zig"),
        };
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
    const file = path.join(this.funRoot, "python", "random_number.py").replaceAll("\\", "\\\\");
    return [
      "import importlib.util",
      `spec = importlib.util.spec_from_file_location('random_number', r'${file}')`,
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "print(module.random_number())",
    ].join("; ");
  }

  private typescriptScript(): string {
    const file = path.join(this.funRoot, "typescript", "randomColor.ts").replaceAll("\\", "\\\\");
    return [
      "const fs = require('node:fs');",
      `let source = fs.readFileSync('${file}', 'utf8');`,
      "source = source.replace('export function randomColor(): string {', 'function randomColor() {');",
      "eval(source + '\nconsole.log(randomColor());');",
    ].join(" ");
  }

  private rustPlan(): ExecutionPlan {
    const cwd = path.join(this.funRoot, "rust");
    const binary = path.join(os.tmpdir(), `iota-fun-rust-${process.pid}.exe`);
    this.ensureFile(path.join(cwd, "runner.rs"));
    this.ensureFile(path.join(cwd, "random_material.rs"));
    return {
      command: "rustc",
      args: ["runner.rs", "-o", binary],
      cwd,
      postCompileCommand: binary,
      postCompileArgs: [],
      cleanup: () => {
        if (fs.existsSync(binary)) {
          fs.unlinkSync(binary);
        }
      },
    };
  }

  private javaPlan(): ExecutionPlan {
    const cwd = path.join(this.funRoot, "java");
    this.ensureFile(path.join(cwd, "RandomAnimal.java"));
    this.ensureFile(path.join(cwd, "RandomAnimalRunner.java"));
    return {
      command: "javac",
      args: ["-encoding", "UTF-8", "RandomAnimal.java", "RandomAnimalRunner.java"],
      cwd,
      postCompileCommand: "java",
      postCompileArgs: ["RandomAnimalRunner"],
      cleanup: () => {
        for (const file of ["RandomAnimal.class", "RandomAnimalRunner.class"]) {
          const target = path.join(cwd, file);
          if (fs.existsSync(target)) {
            fs.unlinkSync(target);
          }
        }
      },
    };
  }

  private cppPlan(): ExecutionPlan {
    const cwd = path.join(this.funRoot, "cpp");
    const binary = path.join(os.tmpdir(), `iota-fun-cpp-${process.pid}.exe`);
    const mingwBin = "C:\\ProgramData\\mingw64\\mingw64\\bin";
    const env = {
      ...process.env,
      PATH: `${mingwBin}${path.delimiter}${process.env.PATH ?? ""}`,
    };
    this.ensureFile(path.join(cwd, "random_action.cpp"));
    this.ensureFile(path.join(cwd, "random_action_runner.cpp"));
    return {
      command: "g++",
      args: ["random_action_runner.cpp", "-o", binary],
      cwd,
      env,
      postCompileCommand: binary,
      postCompileArgs: [],
      postCompileEnv: env,
      cleanup: () => {
        if (fs.existsSync(binary)) {
          fs.unlinkSync(binary);
        }
      },
    };
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
