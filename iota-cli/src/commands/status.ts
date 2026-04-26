import { withEngine } from "./shared.js";

export async function statusCommand(): Promise<void> {
  await withEngine(async (engine) => {
    const status = await engine.status();
    console.log(JSON.stringify(status, null, 2));
  });
}
