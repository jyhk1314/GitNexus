# Git 工作区改造总结（截至 2026-03-24）

本文档汇总当前工作区相对已跟踪基线的**改造方案**与**具体改动**，便于评审、合并与后续维护。  
（说明：`gitnexus/src/core/augmentation/engine.ts`、`gitnexus/src/server/api.ts` 在 `git status` 中可能显示为已修改，但**无有效内容 diff**，多为换行符 CRLF/LF 差异，提交前可用 `git diff` 确认。）

---

## 一、改造目标（方案层）

| 方向 | 目标 |
|------|------|
| **检索与混合排序** | 混合检索（BM25 + 语义）合并时，避免「后出现的低质量语义结果」覆盖「先出现的高质量元数据」；RRF 合并逻辑与注释对齐业务语义。 |
| **全文检索（FTS）** | LadybugDB 连接创建时统一加载 FTS 扩展；`queryFTS` 路径显式确保扩展已加载；从 `initLbug` 中拆出可复用的 `loadFTSExtension`，并处理「已安装/已加载」等幂等场景。 |
| **向量与索引就绪** | `isEmbedderReady` 在判空前异步完成 embedder 初始化与向量索引创建；导出 `createVectorIndex` 供嵌入流程复用。 |
| **Web 与后端契约** | Worker 中规范化后端 Base URL（去引号、去反引号、去尾部斜杠等），避免配置粘贴错误导致请求失败；混合搜索 HTTP 响应改为消费后端返回的统一 `results` 列表结构。 |
| **LLM 工具与 Cypher** | 修正 Neo4j/Ladybug 风格查询：`label(n)` → `labels(n)`；`ORDER BY` 使用列别名；`context` 工具中按节点类型安全构造 `MATCH`，兼容多标签节点。 |
| **体验与上限** | 工具调用结果卡片展示上限由 3000 字符提高到 6000；`read_file` 类工具单文件内容上限提高到 200,000 字符，与大文档说明一致。 |

---

## 二、分模块改造内容

### 1. `gitnexus` — 搜索与 Ladybug（FTS）

- **`gitnexus/src/mcp/core/lbug-adapter.ts`**
  - 在 `createConnection` 内创建 `Connection` 后调用 `loadFTSExtension(conn)`。
  - 从 `initLbug` 移除「池化后对第一条连接执行 `LOAD EXTENSION fts`」的集中加载逻辑。
  - 新增导出函数 `loadFTSExtension`：`INSTALL fts` + `LOAD EXTENSION fts`，并对 `already loaded` / `already installed` 等消息静默，其它错误打日志。
- **`gitnexus/src/core/lbug/lbug-adapter.ts`**
  - `queryFTS` 在查询前 `await loadFTSExtension()`，保证 FTS 可用。

### 2. `gitnexus` — 混合搜索（RRF）

- **`gitnexus/src/core/search/hybrid-search.ts`**
  - `mergeWithRRF`：当同一路径已存在且**已有** `semantic` 来源时，不再用新的语义命中覆盖 `semanticScore` 与节点元数据（`nodeId`、`name`、`label`、行号等），避免低分覆盖高分；补充中文注释说明 RRF 与频次/排序的关系。

### 3. `gitnexus` — 嵌入与向量索引

- **`gitnexus/src/core/embeddings/embedding-pipeline.ts`**
  - `createVectorIndex` 由内部函数改为 **`export`**，供其它模块调用。
- **`gitnexus/src/core/embeddings/embedder.ts`**
  - `isEmbedderReady` 改为 **`async`**，返回 `Promise<boolean>`；内部动态 `import` `createVectorIndex` 与 `executeQuery`，调用 `initEmbedder` 与 `createVectorIndex`，再判断 `embedderInstance`。
- **`gitnexus/src/core/embeddings/types.ts`**
  - 为 `maxSnippetLength` 增加注释：控制 embedding 时代码片段长度上限与算力权衡。

### 4. `gitnexus` — LBug CSV 与缓存

- **`gitnexus/src/core/lbug/csv-generator.ts`**
  - `FileContentCache` 构造函数默认 `maxSize = 3000`，并加注释说明「最大缓存节点个数 3000」。

### 5. `gitnexus-web` — Ingestion Worker（HTTP 查询与搜索）

- **`gitnexus-web/src/workers/ingestion.worker.ts`**
  - 新增 `normalizeBackendBaseUrl`，用于清理用户输入的 URL（反引号、引号、空白、尾部 `/`）。
  - `createHttpExecuteQuery` / `createHttpHybridSearch` 使用规范化后的 Base URL。
  - 混合搜索：响应从假定 `process_symbols` + `definitions` 结构，改为映射 **`body.results`** 数组；按 `sources` 区分 bm25/semantic 组合，保留 `score`、`rank`、`bm25Score`、`semanticScore` 等字段；过滤无 `filePath` 的项并 `slice(0, k)`。

### 6. `gitnexus-web` — LLM 工具

- **`gitnexus-web/src/core/llm/tools.ts`**
  - 大文件读取上限 `MAX_CONTENT`：50,000 → **200,000**。
  - Cypher：`label(n)` → `labels(n)`；`ORDER BY p.stepCount` → `ORDER BY stepCount`（与 `RETURN` 别名一致）。
  - `context` 工具：`nodeType` 从行值或 `id` 前缀解析并校验安全标识符；使用 ``MATCH (n:`Type` {id: ...})`` 或回退到无标签 `MATCH (n {id: ...})`，避免多标签时 `MATCH (n:WrongLabel)` 失败。

### 7. `gitnexus-web` — UI

- **`gitnexus-web/src/components/ToolCallCard.tsx`**
  - 工具结果预览截断：3,000 → **6,000** 字符；提示文案标明仅为页面截断、完整结果仍在上下文中。

---

## 三、涉及文件清单（有内容 diff）

| 路径 | 角色 |
|------|------|
| `gitnexus-web/src/components/ToolCallCard.tsx` | 工具结果展示长度 |
| `gitnexus-web/src/core/llm/tools.ts` | 读文件上限、Cypher、context 匹配 |
| `gitnexus-web/src/workers/ingestion.worker.ts` | Base URL、混合搜索响应映射 |
| `gitnexus/src/core/embeddings/embedder.ts` | `isEmbedderReady` 异步与向量索引 |
| `gitnexus/src/core/embeddings/embedding-pipeline.ts` | 导出 `createVectorIndex` |
| `gitnexus/src/core/embeddings/types.ts` | 配置项注释 |
| `gitnexus/src/core/lbug/csv-generator.ts` | 缓存容量注释 |
| `gitnexus/src/core/lbug/lbug-adapter.ts` | `queryFTS` 前加载 FTS |
| `gitnexus/src/core/search/hybrid-search.ts` | RRF 语义合并策略 |
| `gitnexus/src/mcp/core/lbug-adapter.ts` | 连接级 FTS 加载与 `loadFTSExtension` |

---

## 四、验证与索引建议

1. **FTS**：在启用全文检索的路径上执行一次搜索/分析流程，确认无 「extension not loaded」 类错误。
2. **混合搜索**：Web Worker 连真实 `serve` 时，确认 `/search` 返回的 `results` 与前端映射一致、排名合理。
3. **嵌入就绪**：`isEmbedderReady` 已变为异步；仓库内已同步为 **`await isEmbedderReady()`** 的调用处包括：`gitnexus/src/server/api.ts`（混合搜索分支）、`gitnexus/src/core/embeddings/embedding-pipeline.ts`（`semanticSearch` 入口）。其它 fork/分支若还有同步调用需一并改掉，否则 `if (isEmbedderReady())` 会对 Promise 恒为真。
4. **GitNexus 索引**：合并并发布代码后，若图谱或嵌入逻辑变更影响查询，按项目惯例执行 `npx gitnexus analyze`（若需保留向量，加 `--embeddings`）。

---

## 五、相关文档

- 与上游差异总表：改造点已按目录并入 `DIFF.md` 第二节至第十二节对应小节（无单独日期章节）
- 部署、截断与嵌入模型说明：`docs/DEPLOY.md`
- 分析进度阶段命名：`docs/PROGRESS_PHASES.md`

## 六、走查后代码修正（与 DIFF 中走查表一致）

- **MCP `lbug-adapter`**：`createConnection` 改为异步并 **`await loadFTSExtension(conn)`**，建池与扩容路径均等待完成。  
- **`hybrid-search`**：`mergeWithRRF` 仅在尚未写入 `semantic` 时填充元数据；已合并过语义时只累加 RRF 分。  
- **`ingestion.worker`**：`body.results` 非数组时按 `[]` 处理，避免运行时异常。  
- **`llm/tools.ts`（explore）**：`formatLabelsForDisplay` 提前定义；`normalizeNodeType` 支持 `labels()` 返回数组。
