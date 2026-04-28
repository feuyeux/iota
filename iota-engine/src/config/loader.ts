import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import {
  DEFAULT_CONFIG,
  assertBackendName,
  type IotaConfig,
} from "./schema.js";
import type { RedisConfigStore } from "./redis-store.js";

export interface LoadConfigOptions {
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  /** Optional Redis config store for distributed config overlay. */
  redisConfigStore?: RedisConfigStore;
  /** Backend name for Redis config resolution. */
  backendName?: string;
  /** Session ID for Redis config resolution. */
  sessionId?: string;
  /** User ID for Redis config resolution. */
  userId?: string;
}

export interface ConfigSetOptions extends LoadConfigOptions {
  createIfMissing?: boolean;
}

export function expandHome(input: string, home = os.homedir()): string {
  if (input === "~") {
    return home;
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(home, input.slice(2));
  }
  return input;
}

export async function loadConfig(
  options: LoadConfigOptions = {},
): Promise<IotaConfig> {
  const cwd = options.cwd ?? process.cwd();

  // Load .env files into a local env clone — never mutate process.env.
  // User-level first (lower priority), then project-level (overwrites).
  const dotenvVars: Record<string, string> = {
    ...loadDotenv(path.join(os.homedir(), ".iota", ".env")),
    ...loadDotenv(path.join(cwd, ".env")),
  };
  const env: Record<string, string | undefined> = options.env ?? {
    ...process.env,
    ...dotenvVars,
  };

  const configPath = options.configPath ?? env.IOTA_CONFIG;
  // If explicit config path, use only that file; otherwise use layered merge
  const fileConfig = configPath
    ? readYamlConfig(configPath)
    : loadLayeredConfig(cwd);
  const merged = mergeConfig(DEFAULT_CONFIG, fileConfig);

  if (env.IOTA_DEFAULT_BACKEND) {
    assertBackendName(env.IOTA_DEFAULT_BACKEND, "IOTA_DEFAULT_BACKEND");
    merged.routing.defaultBackend = env.IOTA_DEFAULT_BACKEND;
    merged.engine.defaultBackend = env.IOTA_DEFAULT_BACKEND;
  }
  if (env.IOTA_MODE) {
    if (env.IOTA_MODE !== "development" && env.IOTA_MODE !== "production") {
      throw new Error("IOTA_MODE must be development or production");
    }
    merged.engine.mode = env.IOTA_MODE;
  }

  // Overlay Redis distributed config if store is provided
  if (options.redisConfigStore) {
    const redisOverrides = await options.redisConfigStore.getResolved(
      options.backendName,
      options.sessionId,
      options.userId,
    );
    applyFlatOverrides(merged, redisOverrides);
  }

  validateConfig(merged);
  return normalizeConfig(merged, cwd, env);
}

export function resolveConfigPath(options: LoadConfigOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  return (
    options.configPath ??
    env.IOTA_CONFIG ??
    findConfig(cwd) ??
    path.join(cwd, "iota.config.yaml")
  );
}

export async function setConfigValue(
  fieldPath: string,
  value: unknown,
  options: ConfigSetOptions = {},
): Promise<void> {
  const configPath = resolveConfigPath(options);
  if (!fs.existsSync(configPath) && !options.createIfMissing) {
    throw new Error(`Config file does not exist: ${configPath}`);
  }

  const current = fs.existsSync(configPath)
    ? (readYamlConfig(configPath) as Record<string, unknown>)
    : {};
  setPath(current, fieldPath, value);
  await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
  await fs.promises.writeFile(
    configPath,
    yaml.dump(current, { lineWidth: 120, noRefs: true }),
    "utf8",
  );
}

/**
 * Section 14.1: Config file resolution
 * Project-level config overrides user-level config. Both are merged.
 */
function findConfig(cwd: string): string | undefined {
  const projectConfig = path.join(cwd, "iota.config.yaml");
  if (fs.existsSync(projectConfig)) {
    return projectConfig;
  }

  const userConfig = path.join(os.homedir(), ".iota", "config.yaml");
  return fs.existsSync(userConfig) ? userConfig : undefined;
}

/** Load and merge both user and project configs (project overrides user) */
function loadLayeredConfig(cwd: string): Partial<IotaConfig> {
  const userConfig = path.join(os.homedir(), ".iota", "config.yaml");
  const projectConfig = path.join(cwd, "iota.config.yaml");

  let base: Partial<IotaConfig> = {};
  if (fs.existsSync(userConfig)) {
    base = readYamlConfig(userConfig);
  }
  if (fs.existsSync(projectConfig)) {
    const project = readYamlConfig(projectConfig);
    base = mergeConfig(base, project) as Partial<IotaConfig>;
  }
  return base;
}

function readYamlConfig(configPath: string): Partial<IotaConfig> {
  const content = fs.readFileSync(configPath, "utf8");
  const parsed = yaml.load(content);
  if (parsed === null || typeof parsed !== "object") {
    return {};
  }
  return parsed as Partial<IotaConfig>;
}

function setPath(
  root: Record<string, unknown>,
  fieldPath: string,
  value: unknown,
): void {
  const parts = fieldPath.split(".").filter(Boolean);
  if (parts.length === 0) {
    throw new Error("Config path cannot be empty");
  }

  let current = root;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!isPlainObject(child)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1) as string] = value;
}

function applyFlatOverrides(
  config: IotaConfig,
  overrides: Record<string, string>,
): void {
  for (const [fieldPath, value] of Object.entries(overrides)) {
    setPath(
      config as unknown as Record<string, unknown>,
      fieldPath,
      parseValue(value),
    );
  }
}

function parseValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (
    (value.startsWith("[") && value.endsWith("]")) ||
    (value.startsWith("{") && value.endsWith("}"))
  ) {
    return JSON.parse(value);
  }
  return value;
}

function mergeConfig<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : (override as T);
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = mergeConfig((base as Record<string, unknown>)[key], value);
  }
  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateConfig(config: IotaConfig): void {
  assertBackendName(config.engine.defaultBackend, "engine.defaultBackend");
  assertBackendName(config.routing.defaultBackend, "routing.defaultBackend");
  for (const backend of config.routing.disabledBackends) {
    assertBackendName(backend, "routing.disabledBackends[]");
  }
}

function normalizeConfig(
  config: IotaConfig,
  cwd: string,
  env: NodeJS.ProcessEnv,
): IotaConfig {
  const workingDirectory = path.resolve(cwd, config.engine.workingDirectory);
  const redisHost = env.REDIS_HOST;
  const redisPort = env.REDIS_PORT ? Number(env.REDIS_PORT) : undefined;
  return {
    ...config,
    engine: {
      ...config.engine,
      workingDirectory,
    },
    skill: {
      ...config.skill,
      roots: config.skill.roots.map((root) =>
        path.resolve(cwd, expandHome(root)),
      ),
    },
    storage: {
      ...config.storage,
      development: {
        ...config.storage.development,
        redis: {
          ...config.storage.development.redis,
          host: redisHost ?? config.storage.development.redis.host,
          port: redisPort ?? config.storage.development.redis.port,
        },
      },
      production: {
        ...config.storage.production,
        redis: {
          ...config.storage.production.redis,
          host: redisHost ?? config.storage.production.redis.host,
          port: redisPort ?? config.storage.production.redis.port,
        },
      },
    },
  };
}

/**
 * Load a .env file and return its key-value pairs.
 * Does NOT mutate process.env — callers merge the result explicitly.
 */
function loadDotenv(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return vars;
  try {
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex < 1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
  } catch (err) {
    // Non-fatal: ignore malformed .env files
    console.warn(`[iota-engine] Failed to parse .env file ${filePath}:`, err);
  }
  return vars;
}

/**
 * Export config to a YAML file.
 */
export async function exportConfig(
  config: IotaConfig,
  filePath: string,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(
    filePath,
    yaml.dump(config, { lineWidth: 120, noRefs: true }),
    "utf8",
  );
}

/**
 * Import config from a YAML file into a RedisConfigStore global scope.
 */
export async function importConfigToRedis(
  filePath: string,
  store: RedisConfigStore,
): Promise<number> {
  const content = await fs.promises.readFile(filePath, "utf8");
  const parsed = yaml.load(content);
  if (!isPlainObject(parsed)) {
    throw new Error("Config file must contain an object");
  }
  const flat = flattenObject(parsed as Record<string, unknown>);
  if (Object.keys(flat).length > 0) {
    await store.setMany("global", flat);
  }
  return Object.keys(flat).length;
}

/** Flatten a nested object to dot-notation keys with string values. */
function flattenObject(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      Object.assign(
        result,
        flattenObject(value as Record<string, unknown>, fullKey),
      );
    } else if (value !== undefined && value !== null) {
      result[fullKey] =
        typeof value === "string" ? value : JSON.stringify(value);
    }
  }
  return result;
}
