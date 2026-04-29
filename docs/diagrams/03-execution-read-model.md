# Execution And Read Model Flow

Source paths: `iota-engine/src/engine.ts`, `iota-agent/src/routes/websocket.ts`, `iota-engine/src/visibility/app-read-model.ts`, `iota-app/src/store/useSessionStore.ts`.

```mermaid
flowchart TB
  User["Prompt from CLI, REST, or WebSocket"] --> Build["IotaEngine.buildRequest()<br/>session lookup, backend resolve,<br/>context + memory injection"]
  Build --> Idem["Idempotency check<br/>requestHash on executionId"]
  Idem --> Lock["Redis lock<br/>iota:lock:execution:{executionId}<br/>fencing token renewal"]
  Lock --> Snapshot["Workspace hash scan<br/>write local workspace snapshot"]
  Snapshot --> Record["Create execution record<br/>iota:exec:{executionId}"]
  Record --> States["Persist queued -> starting -> running"]
  States --> Backend["Backend adapter stream<br/>native protocol to RuntimeEvent"]

  Backend --> Normalize["RuntimeEvent normalization<br/>output, state, tool_call,<br/>tool_result, file_delta,<br/>extension, error, memory"]
  Normalize --> Guard["Engine guards<br/>approval policy, path guard,<br/>MCP routing, memory extraction"]
  Guard --> Persist["RuntimeEventStore.append()<br/>sequence + timestamp<br/>Redis Stream iota:events:{executionId}"]
  Persist --> Mux["EventMultiplexer<br/>live fan-out + replay"]
  Persist --> Visibility["VisibilityCollector<br/>context, token ledger,<br/>spans, mappings, memory"]
  Visibility --> VisStore["Visibility store<br/>iota:visibility:*"]
  Mux --> AgentWS["Agent WebSocket<br/>event + event-derived app_delta"]
  VisStore --> Post["Post-execution visibility readback<br/>token, memory, summary, trace deltas"]
  Post --> AgentWS
  Persist --> Final["Update execution<br/>completed, failed, or interrupted<br/>release lock"]

  AgentWS --> AppStore["iota-app useSessionStore.mergeDelta()<br/>activeExecution only"]
  SnapshotApi["GET /sessions/:id/app-snapshot"] --> Builder["buildAppSessionSnapshot()<br/>buildAppExecutionSnapshot()"]
  Builder --> AppSnapshot["app_snapshot"]
  AppSnapshot --> AppStore
  AppStore --> UI["Chat timeline, inspector,<br/>workspace, backend status"]
```
