import { IotaEngine } from "@iota/engine";

/**
 * Shared engine lifecycle helper: create → init → fn → destroy.
 * Ensures the engine is always cleaned up, even on error.
 */
export async function withEngine(
  fn: (engine: IotaEngine) => Promise<void>,
  options?: { cwd?: string },
): Promise<void> {
  const engine = new IotaEngine({
    workingDirectory: options?.cwd ?? process.cwd(),
  });
  await engine.init();
  try {
    await fn(engine);
  } finally {
    await engine.destroy();
  }
}
