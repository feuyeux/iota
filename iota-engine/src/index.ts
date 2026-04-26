export { IotaEngine } from "./engine.js";
export type {
  CreateSessionOptions,
  IotaEngineOptions,
  Session,
  StreamInput,
} from "./engine.js";
export type {
  ApprovalPolicy,
  BackendName,
  ErrorEvent,
  ExtensionEvent,
  FileDeltaEvent,
  McpServerDescriptor,
  MemoryBlock,
  MemoryKind,
  Message,
  OutputEvent,
  RuntimeContext,
  RuntimeEvent,
  RuntimeRequest,
  RuntimeResponse,
  StateEvent,
  TokenUsage,
  ToolCallEvent,
  ToolResultEvent,
} from "./event/types.js";
export type {
  BackendCapabilities,
  BackendConfig,
  BackendSnapshot,
  HealthStatus,
  RuntimeBackend,
} from "./backend/interface.js";
export { ErrorCode, IotaError } from "./error/codes.js";
export { CliApprovalHook } from "./approval/cli-hook.js";
export { DeferredApprovalHook } from "./approval/deferred-hook.js";
export type {
  ApprovalHook,
  ApprovalDecision,
  ApprovalRequest,
} from "./approval/hook.js";
export {
  loadConfig,
  resolveConfigPath,
  setConfigValue,
  exportConfig,
  importConfigToRedis,
} from "./config/loader.js";
export type { IotaConfig } from "./config/schema.js";
export { BACKEND_NAMES, assertBackendName } from "./config/schema.js";
export { RedisConfigStore } from "./config/redis-store.js";
export type {
  ConfigScope,
  RedisConfigStoreConfig,
} from "./config/redis-store.js";
export { RedisPubSub } from "./storage/pubsub.js";
export type {
  PubSubConfig,
  PubSubChannel,
  ConfigChangeEvent,
} from "./storage/pubsub.js";
export { runMemoryGc } from "./memory/gc.js";
export type { GcResult } from "./memory/gc.js";
export type { WorkspaceSnapshot } from "./workspace/snapshot.js";
export {
  normalizeEvent,
  isValidEvent,
  sanitizeEvent,
} from "./event/normalizer.js";
export type { MetricsSnapshot } from "./metrics/collector.js";
export type {
  StorageBackend,
  LockLease,
  ExecutionRecord,
  LogAggregation,
  LogQueryOptions,
  RuntimeLogEntry,
} from "./storage/interface.js";
export { RedisStorage } from "./storage/redis.js";
export type { RedisStorageConfig } from "./storage/redis.js";
export { MilvusMemoryStore } from "./storage/milvus.js";
export type { MilvusMemoryConfig } from "./storage/milvus.js";
export { MinioSnapshotStore } from "./storage/minio.js";
export type { MinioSnapshotConfig } from "./storage/minio.js";
export {
  HashEmbeddingProvider,
  EmbeddingProviderChain,
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
  createDefaultEmbeddingChain,
  cosineSimilarity,
} from "./memory/embedding.js";
export type { EmbeddingProvider } from "./memory/embedding.js";
export { extractMemory } from "./memory/extractor.js";
export type { ExtractedMetadata } from "./memory/extractor.js";
export { injectMemory } from "./memory/injector.js";
export type { InjectOptions } from "./memory/injector.js";
export { injectMemoryWithVisibility } from "./memory/injector.js";
export type {
  InjectWithVisibilityOptions,
  InjectWithVisibilityResult,
} from "./memory/injector.js";
export { MemoryRetriever } from "./memory/retriever.js";
export type { StoredMemory, RetrievalResult } from "./memory/retriever.js";

// Visibility Plane
export type {
  VisibilityLevel,
  VisibilityPolicy,
  RedactionSummary,
  ContextManifest,
  ContextSegment,
  ContextSegmentKind,
  TokenLedger,
  TokenUsageBreakdown,
  NativeUsageVisibility,
  ExecutionTrace,
  TraceAggregation,
  TraceAggregationOptions,
  TraceSpan,
  TraceSpanKind,
  TraceSpanNode,
  MemoryVisibilityRecord,
  MemoryCandidateVisibility,
  MemorySelectedVisibility,
  MemoryExcludedVisibility,
  MemoryExtractionVisibility,
  LinkVisibilityRecord,
  NativeEventRef,
  EventMappingVisibility,
  ExecutionVisibility,
  ExecutionVisibilitySummary,
  VisibilityListOptions,
} from "./visibility/types.js";
export { DEFAULT_VISIBILITY_POLICY } from "./visibility/types.js";
export {
  aggregateExecutionTraces,
  buildExecutionTrace,
  buildTraceTree,
} from "./visibility/trace.js";
export type { VisibilityStore } from "./visibility/store.js";
export { VisibilityCollector } from "./visibility/collector.js";
export { RedisVisibilityStore } from "./visibility/redis-store.js";
export { LocalVisibilityStore } from "./visibility/local-store.js";
export {
  estimateTokens,
  getTokenEstimator,
  setTokenEstimator,
} from "./visibility/token-estimator.js";
export type { TokenEstimator } from "./visibility/token-estimator.js";
export {
  contentHash,
  makePreview,
  redactArgs,
  redactText,
  summarizeEnv,
  isSecretEnvName,
} from "./visibility/redaction.js";
export {
  buildAppExecutionSnapshot,
  buildAppSessionSnapshot,
} from "./visibility/snapshot-builder.js";
export type {
  AppExecutionSnapshot,
  AppSessionSnapshot,
  AppVisibilityDelta,
  BackendStatusView,
  ConversationListItem,
  ConversationTimelineItem,
  ConversationTimelineView,
  MemoryCardView,
  MemoryPanelDelta,
  MemoryPanelView,
  SessionSummaryView,
  SessionTracingView,
  TokenStatsView,
  TraceDetailView,
  TraceOverviewView,
  TracePerformanceView,
  TraceStepView,
} from "./visibility/app-read-model.js";
