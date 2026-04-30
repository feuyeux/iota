import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import type { BackendConfig } from "./interface.js";

export function prepareHermesBackendConfig(config: BackendConfig): {
  config: BackendConfig;
  generatedHermesHome?: string;
  model?: string;
} {
  const env = { ...(config.env ?? {}) };
  const hermesConfig = resolveHermesDistributedConfig(env);
  if (!hermesConfig) {
    return { config, model: undefined };
  }

  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "iota-hermes-"));
  fs.chmodSync(hermesHome, 0o700);
  fs.writeFileSync(
    path.join(hermesHome, "config.yaml"),
    yaml.dump(
      {
        model: {
          default: hermesConfig.model,
          provider: hermesConfig.provider,
          base_url: hermesConfig.baseUrl,
        },
        toolsets: ["hermes-acp"],
        terminal: {
          backend: "local",
          cwd: ".",
        },
      },
      { lineWidth: -1, noRefs: true },
    ),
    { mode: 0o600 },
  );

  return {
    generatedHermesHome: hermesHome,
    model: hermesConfig.model,
    config: {
      ...config,
      env: {
        ...env,
        HERMES_HOME: hermesHome,
        HERMES_INFERENCE_PROVIDER: hermesConfig.provider,
        ...renderHermesProviderEnv(hermesConfig),
      },
    },
  };
}

interface HermesDistributedConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

function resolveHermesDistributedConfig(
  env: Record<string, string>,
): HermesDistributedConfig | undefined {
  const apiKey = firstNonEmpty(env.HERMES_API_KEY, env.HERMES_AUTH_TOKEN);
  const baseUrl = firstNonEmpty(env.HERMES_BASE_URL, env.HERMES_ENDPOINT);
  const model = firstNonEmpty(env.HERMES_MODEL, env.HERMES_DEFAULT_MODEL);
  const explicitProvider = firstNonEmpty(
    env.HERMES_PROVIDER,
    env.HERMES_INFERENCE_PROVIDER,
  );

  if (!apiKey && !baseUrl && !model && !explicitProvider) {
    return undefined;
  }

  const provider = explicitProvider || inferHermesProvider(baseUrl);
  return {
    provider,
    model: model || "MiniMax-M2.7",
    baseUrl: baseUrl || defaultHermesBaseUrl(provider),
    apiKey,
  };
}

function inferHermesProvider(baseUrl: string): string {
  const normalized = baseUrl.toLowerCase();
  if (normalized.includes("minimaxi.com")) return "minimax-cn";
  if (normalized.includes("minimax.io")) return "minimax";
  if (normalized.includes("anthropic.com")) return "anthropic";
  return "custom";
}

function defaultHermesBaseUrl(provider: string): string {
  switch (provider) {
    case "minimax-cn":
      return "https://api.minimaxi.com/anthropic";
    case "minimax":
      return "https://api.minimax.io/anthropic";
    case "anthropic":
      return "https://api.anthropic.com";
    default:
      return "";
  }
}

function renderHermesProviderEnv(
  config: HermesDistributedConfig,
): Record<string, string> {
  const env: Record<string, string> = {
    HERMES_INFERENCE_PROVIDER: config.provider,
    HERMES_MODEL: config.model,
  };

  if (config.provider === "minimax-cn") {
    env.MINIMAX_CN_API_KEY = config.apiKey;
    env.MINIMAX_CN_BASE_URL = config.baseUrl;
  } else if (config.provider === "minimax") {
    env.MINIMAX_API_KEY = config.apiKey;
    env.MINIMAX_BASE_URL = config.baseUrl;
  } else if (config.provider === "anthropic") {
    env.ANTHROPIC_API_KEY = config.apiKey;
    env.ANTHROPIC_TOKEN = config.apiKey;
    env.ANTHROPIC_BASE_URL = config.baseUrl;
  } else {
    env.OPENAI_API_KEY = config.apiKey;
    env.OPENAI_BASE_URL = config.baseUrl;
  }

  for (const [key, value] of Object.entries(env)) {
    if (value.length === 0) {
      delete env[key];
    }
  }

  return env;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value && value.trim().length > 0)?.trim() ?? "";
}
