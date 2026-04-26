import { BACKEND_NAMES, setConfigValue, type BackendName } from "@iota/engine";

const BACKENDS = new Set<BackendName>(BACKEND_NAMES);

export async function switchCommand(
  backend: string,
  cwd = process.cwd(),
): Promise<void> {
  if (!BACKENDS.has(backend as BackendName)) {
    throw new Error(`Unknown backend ${backend}`);
  }
  await setConfigValue("routing.defaultBackend", backend, {
    cwd,
    createIfMissing: true,
  });
  await setConfigValue("engine.defaultBackend", backend, {
    cwd,
    createIfMissing: true,
  });
  console.log(`Switched default backend to ${backend}.`);
}
