import type { BackendName } from "../event/types.js";

export function noFallback(backend: BackendName): BackendName {
  return backend;
}
