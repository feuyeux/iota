import type { FastifyInstance } from "fastify";
import type { BackendName, BackendStatusView } from "@iota/engine";

/**
 * Maps raw engine backend status and capabilities to the App Read Model view.
 */
export async function getMappedBackendStatus(
  fastify: FastifyInstance,
  activeBackend?: string,
): Promise<BackendStatusView[]> {
  const backendStatus = await fastify.engine.status();
  const allCapabilities = fastify.engine.backendCapabilities();

  return Object.entries(backendStatus).map(([name, status]) => {
    const caps = allCapabilities[name as BackendName];

    let uiStatus: BackendStatusView["status"] = "online";
    if (!status.healthy) {
      uiStatus = status.status === "crashed" ? "offline" : "degraded";
    } else if (status.activeExecutions > 0) {
      uiStatus = "busy";
    }

    // Check if circuit breaker is actually open (if status.lastError matches breaker)
    if (status.lastError === "Circuit breaker is open") {
      uiStatus = "circuit_open";
    }

    return {
      backend: name as BackendName,
      label: name,
      status: uiStatus,
      active: name === activeBackend,
      capabilities: {
        streaming: caps?.streaming ?? false,
        mcp: caps?.mcp ?? false,
        memoryVisibility: true,
        tokenVisibility: true,
        chainVisibility: true,
      },
    };
  });
}
