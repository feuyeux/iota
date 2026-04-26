import { Command } from "commander";
import {
  loadConfig,
  exportConfig,
  importConfigToRedis,
  type ConfigScope,
} from "@iota/engine";
import { withEngine } from "./shared.js";

export function configCommand(): Command {
  const command = new Command("config").description(
    "Manage distributed configuration in Redis",
  );

  command
    .command("get")
    .argument("[path]")
    .option("--scope <scope>", "Config scope: global, backend, session, user")
    .option(
      "--scope-id <id>",
      "Scope identifier (backend name, session id, etc.)",
    )
    .action(
      async (
        fieldPath?: string,
        opts?: { scope?: string; scopeId?: string },
      ) => {
        if (opts?.scope) {
          // Read from Redis distributed config
          await withEngine(async (engine) => {
            const store = engine.getConfigStore();
            if (!store) {
              console.error("Redis config store not available");
              process.exitCode = 1;
              return;
            }
            const scope = opts.scope as ConfigScope;
            if (fieldPath) {
              const value = await store.getKey(scope, fieldPath, opts.scopeId);
              console.log(value ?? "(not set)");
            } else {
              const data = await store.get(scope, opts.scopeId);
              console.log(JSON.stringify(data, null, 2));
            }
          });
        } else {
          // Read from resolved config (files + defaults + Redis overlay)
          await withEngine(async (engine) => {
            const store = engine.getConfigStore();
            const config = await loadConfig({
              cwd: process.cwd(),
              redisConfigStore: store ?? undefined,
            });
            const value = fieldPath
              ? getPath(config as unknown as Record<string, unknown>, fieldPath)
              : config;
            console.log(JSON.stringify(value, null, 2));
          });
        }
      },
    );

  command
    .command("set")
    .argument("<path>")
    .argument("<value>")
    .option(
      "--scope <scope>",
      "Config scope: global, backend, session, user",
      "global",
    )
    .option(
      "--scope-id <id>",
      "Scope identifier (backend name, session id, etc.)",
    )
    .action(
      async (
        fieldPath: string,
        value: string,
        opts: { scope: string; scopeId?: string },
      ) => {
        await withEngine(async (engine) => {
          const store = engine.getConfigStore();
          if (!store) {
            console.error("Redis config store not available");
            process.exitCode = 1;
            return;
          }
          const scope = opts.scope as ConfigScope;
          await store.set(
            scope,
            fieldPath,
            String(parseConfigValue(value)),
            opts.scopeId,
          );
          console.log(
            `[redis:${scope}${opts.scopeId ? `:${opts.scopeId}` : ""}] ${fieldPath} = ${value}`,
          );
        });
      },
    );

  command
    .command("delete")
    .alias("del")
    .argument("<path>")
    .option(
      "--scope <scope>",
      "Config scope: global, backend, session, user",
      "global",
    )
    .option("--scope-id <id>", "Scope identifier")
    .action(
      async (fieldPath: string, opts: { scope: string; scopeId?: string }) => {
        await withEngine(async (engine) => {
          const store = engine.getConfigStore();
          if (!store) {
            console.error("Redis config store not available");
            process.exitCode = 1;
            return;
          }
          await store.del(opts.scope as ConfigScope, fieldPath, opts.scopeId);
          console.log(
            `Deleted ${fieldPath} from ${opts.scope}${opts.scopeId ? `:${opts.scopeId}` : ""}`,
          );
        });
      },
    );

  command
    .command("export")
    .argument("<file>", "Output YAML file path")
    .description("Export current resolved config to a YAML file")
    .action(async (file: string) => {
      await withEngine(async (engine) => {
        const store = engine.getConfigStore();
        const config = await loadConfig({
          cwd: process.cwd(),
          redisConfigStore: store ?? undefined,
        });
        await exportConfig(config, file);
        console.log(`Config exported to ${file}`);
      });
    });

  command
    .command("import")
    .argument("<file>", "Input YAML file path")
    .description("Import config from YAML into Redis global scope")
    .action(async (file: string) => {
      await withEngine(async (engine) => {
        const store = engine.getConfigStore();
        if (!store) {
          console.error("Redis config store not available");
          process.exitCode = 1;
          return;
        }
        const count = await importConfigToRedis(file, store);
        console.log(`Imported ${count} config keys to Redis global scope`);
      });
    });

  command
    .command("list-scopes")
    .argument("<scope>", "Scope type: backend, session, user")
    .description("List all scope IDs for a given scope type")
    .action(async (scope: string) => {
      await withEngine(async (engine) => {
        const store = engine.getConfigStore();
        if (!store) {
          console.error("Redis config store not available");
          process.exitCode = 1;
          return;
        }
        const ids = await store.listScopes(scope as ConfigScope);
        for (const id of ids) {
          console.log(id);
        }
      });
    });

  return command;
}

function getPath(root: Record<string, unknown>, fieldPath: string): unknown {
  return fieldPath.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, root);
}

function parseConfigValue(value: string): unknown {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null") {
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }
  if (
    (value.startsWith("[") && value.endsWith("]")) ||
    (value.startsWith("{") && value.endsWith("}"))
  ) {
    return JSON.parse(value);
  }
  return value;
}
