import { Transform, type TransformCallback } from "node:stream";

export class NdjsonParseError extends Error {
  readonly line: string;

  constructor(line: string, cause: unknown) {
    super(
      `Invalid NDJSON frame: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "NdjsonParseError";
    this.line = line;
  }
}

export function encodeNdjson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function parseNdjsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new NdjsonParseError(line, error);
  }
}

export class NdjsonParser extends Transform {
  private buffer = "";

  constructor() {
    super({ readableObjectMode: true });
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.buffer += chunk.toString("utf8");
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        this.push(parseNdjsonLine(line));
      } catch (error) {
        this.emit("frameError", error);
      }
    }
    callback();
  }

  override _flush(callback: TransformCallback): void {
    const line = this.buffer.trim();
    if (line) {
      try {
        this.push(parseNdjsonLine(line));
      } catch (error) {
        this.emit("frameError", error);
      }
    }
    callback();
  }
}
