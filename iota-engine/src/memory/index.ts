export { MemoryMapper, memoryMapper } from "./mapper.js";
export { MemoryExtractor } from "./extractor.js";
export type { MemoryExtractionInput, MemoryExtractionResult } from "./extractor.js";
export { MemoryStorage, getUserProfile, type MemoryStorageBackend } from "./storage.js";
export {
  MemoryInjector,
  injectMemory,
  injectMemoryWithVisibility,
} from "./injector.js";
export type {
  BackendMemoryEvent,
  MemoryContext,
  MemoryQuery,
  MemoryFacet,
  MemoryScope,
  MemoryScopeContext,
  MemoryType,
  MemorySearchResult,
  MemorySource,
  StoredMemory,
  UnifiedMemory,
} from "./types.js";
export { DialogueMemory } from "./dialogue.js";
export { WorkingMemory } from "./working.js";
export { runMemoryGc, type GcResult } from "./gc.js";

export {
  HashEmbeddingProvider,
  EmbeddingProviderChain,
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
  createDefaultEmbeddingChain,
  cosineSimilarity,
} from "./embedding.js";
export type { EmbeddingProvider } from "./embedding.js";
