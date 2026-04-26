import { ErrorCode, IotaError } from "../error/codes.js";
import type { BackendName } from "../event/types.js";
import type { IotaConfig } from "../config/schema.js";

export class BackendResolver {
  constructor(private readonly config: IotaConfig) {}

  resolve(requested?: BackendName): BackendName {
    const backend = requested ?? this.config.routing.defaultBackend;
    if (this.config.routing.disabledBackends.includes(backend)) {
      throw new IotaError({
        code: ErrorCode.BACKEND_UNAVAILABLE,
        message: `Backend ${backend} is disabled by configuration`,
        retryable: false,
      });
    }
    return backend;
  }
}
