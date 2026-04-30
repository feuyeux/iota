# Memory 优化技术规划（已合并）

**版本:** 2.1  
**最后更新:** 2026-04-30  
**状态:** 已合并到 [08-memory.md](./08-memory.md)

本文件原先记录 Memory 优化规划。当前代码已实现 hash 去重、history、embeddingJson、vector scoring fallback、`getUserProfile` 等能力；仍待完善的 LLM 合并决策、entity extraction、Milvus 向量后端和 session compaction 已合并到 `08-memory.md` 的“实现状态与待完善”章节。

后续请维护 `08-memory.md`，不要在本文件继续追加主线设计。
