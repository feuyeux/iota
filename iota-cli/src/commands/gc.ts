import { runMemoryGc } from "@iota/engine";

export async function gcCommand(): Promise<void> {
  const result = await runMemoryGc({ cwd: process.cwd() });
  console.log(JSON.stringify(result, null, 2));
}
