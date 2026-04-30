import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline, { type Interface as ReadlineInterface } from "node:readline";

export interface McpClient {
  request(method: string, params?: unknown): Promise<unknown>;
  close?(): Promise<void>;
}

export class StdioMcpClient implements McpClient {
  private child?: ChildProcessWithoutNullStreams;
  private rl?: ReadlineInterface;
  private exitPromise?: Promise<void>;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();

  /** Request timeout in milliseconds (default 30 s). */
  private readonly timeoutMs: number;

  constructor(
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly env: Record<string, string> = {},
    options?: { timeoutMs?: number },
  ) {
    this.timeoutMs = options?.timeoutMs ?? 30_000;
  }

  async start(): Promise<void> {
    if (this.child) {
      return;
    }
    const child = spawn(this.command, this.args, {
      stdio: "pipe",
      env: { ...process.env, ...this.env },
      windowsHide: true,
    });
    this.child = child;
    this.rl = readline.createInterface({ input: child.stdout });
    this.rl.on("line", (line) => this.handleLine(line));
    child.once("error", (error) => this.rejectAll(error));
    this.exitPromise = new Promise<void>((resolve) => {
      child.once("exit", (code, signal) => {
        this.rejectAll(
          new Error(`MCP server exited with ${code ?? signal ?? "unknown"}`),
        );
        this.rl?.close();
        this.rl = undefined;
        try {
          child.stdin.destroy();
        } catch {
          /* ignore */
        }
        if (this.child === child) {
          this.child = undefined;
        }
        resolve();
      });
    });

    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "iota-engine", version: "0.1.0" },
    });
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    await this.ensureStarted();
    const id = this.nextId;
    this.nextId += 1;
    const message = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `MCP request "${method}" timed out after ${this.timeoutMs}ms`,
          ),
        );
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child?.stdin.write(message, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }
    const exit = this.exitPromise;
    // Try graceful shutdown first: close stdin, then SIGINT.
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
    try {
      child.kill("SIGINT");
    } catch {
      /* ignore */
    }
    // Force-kill if it doesn't exit promptly.
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 500);
    timer.unref?.();
    try {
      await exit;
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureStarted(): Promise<void> {
    if (!this.child) {
      const start = this.start.bind(this);
      await start();
    }
  }

  private handleLine(line: string): void {
    if (!line.trim()) {
      return;
    }
    let message: {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }
    if (typeof message.id !== "number") {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? "MCP request failed"));
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
