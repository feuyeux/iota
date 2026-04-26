import type {
  ApprovalPolicy,
  BackendName,
  McpServerDescriptor,
} from "../event/types.js";
import type { VisibilityPolicy } from "../visibility/types.js";

export interface BackendSection {
  executable: string;
  timeoutMs: number;
  env: Record<string, string>;
}

export interface IotaConfig {
  engine: {
    mode: "development" | "production";
    workingDirectory: string;
    defaultBackend: BackendName;
    eventRetentionHours: number;
  };
  routing: {
    defaultBackend: BackendName;
    disabledBackends: BackendName[];
  };
  backend: {
    claudeCode: BackendSection;
    codex: BackendSection;
    gemini: BackendSection;
    hermes: BackendSection;
  };
  approval: Required<ApprovalPolicy>;
  visibility: VisibilityPolicy;
  storage: {
    development: {
      redis: RedisSection;
    };
    production: {
      redis: RedisSection;
      milvus: {
        address: string;
        collectionName?: string;
        dimension?: number;
      };
      minio: {
        endPoint: string;
        port?: number;
        useSSL?: boolean;
        accessKey: string;
        secretKey: string;
        bucket: string;
      };
    };
  };
  mcp: {
    servers: McpServerDescriptor[];
  };
}

export interface RedisSection {
  sentinels: Array<{ host: string; port: number }>;
  password?: string;
  streamPrefix: string;
  masterName?: string;
  host?: string;
  port?: number;
}

export const BACKEND_NAMES: BackendName[] = [
  "claude-code",
  "codex",
  "gemini",
  "hermes",
];

export const DEFAULT_CONFIG: IotaConfig = {
  engine: {
    mode: "development",
    workingDirectory: ".",
    defaultBackend: "claude-code",
    eventRetentionHours: 24,
  },
  routing: {
    defaultBackend: "claude-code",
    disabledBackends: [],
  },
  backend: {
    claudeCode: { executable: "claude", timeoutMs: 600_000, env: {} },
    codex: { executable: "codex", timeoutMs: 600_000, env: {} },
    gemini: { executable: "gemini", timeoutMs: 600_000, env: {} },
    hermes: { executable: "hermes", timeoutMs: 600_000, env: {} },
  },
  approval: {
    shell: "auto",
    fileOutside: "ask",
    network: "auto",
    container: "ask",
    mcpExternal: "ask",
    privilegeEscalation: "ask",
    timeoutMs: 120_000,
  },
  visibility: {
    memory: "preview",
    tokens: "summary",
    chain: "summary",
    rawProtocol: "off",
    previewChars: 240,
    persistFullContent: false,
    redactSecrets: true,
  },
  storage: {
    development: {
      redis: {
        sentinels: [],
        host: "localhost",
        port: 6379,
        streamPrefix: "iota:events",
        masterName: "mymaster",
      },
    },
    production: {
      redis: {
        sentinels: [],
        host: "localhost",
        port: 6379,
        streamPrefix: "iota:events",
        masterName: "mymaster",
      },
      milvus: {
        address: "localhost:19530",
        collectionName: "iota_memories",
        dimension: 1024,
      },
      minio: {
        endPoint: "localhost",
        port: 9002,
        useSSL: false,
        accessKey: "iota",
        secretKey: "iotasecret",
        bucket: "iota-snapshots",
      },
    },
  },
  mcp: {
    servers: [],
  },
};

export function assertBackendName(
  value: unknown,
  fieldName: string,
): asserts value is BackendName {
  if (!BACKEND_NAMES.includes(value as BackendName)) {
    throw new Error(`${fieldName} must be one of ${BACKEND_NAMES.join(", ")}`);
  }
}
