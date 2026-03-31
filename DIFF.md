# Difflog

本文档记录当前仓库版本与原分支的差异点, 部分个性化需求不会再往原分支主动同步。

**撰写约定：** 同一逻辑路径（文件/目录）在文中 **只出现一条**，该文件的多轮改动合并为 **一段说明**（用分号或逗号串联），避免同一文件名反复占多条编号。

## 与 https://github.com/abhigyanpatwari/GitNexus v1.4.0 差异内容分析:

### 后台服务

#### 一、gitnexus/scripts

**中文本地化支撑：**

1. **convert_to_utf8.py - gitnexus下载仓库后自动转换所有字符集到UTF8**

#### 二、gitnexus/src/server

**核心功能增强及新增API端点：**

1. **api.ts** — 表名转义（`BACKTICK_TABLES`、`escapeTableName`）；`createServer` 支持 embeddings；`POST /api/repos/clone-analyze`（克隆分析、token/分支、流式、UTF-8、进度、已存在处理）；`POST /api/repos/zip-upload-analyze`（ZIP≤500MB、单层目录、git init、流式）；`GET|POST /api/proxy`（Git 代理）；分析完成 `closeLbugForPath`；扩展 fs/进程/ZIP 等依赖；错误与流式日志；路径工具 `getCodeBaseDir`、`getCodeDir`、`getRepoNameFromUrl`、`pathEquals`；混合搜索分支 `await isEmbedderReady()`。
2. **mcp-http.ts** — `DELETE /api/mcp/sessions/:sessionId` 清理 MCP session（204/404）。

#### 三、gitnexus/src/mcp/core

**中文本地化支撑：**

1. **embedder.ts - 强制写死hf镜像站**
2. **lbug-adapter.ts - 连接创建时 await loadFTSExtension(conn)；initLbug 预建连接池逐连接加载 FTS；移除池化后集中 LOAD EXTENSION；导出异步 loadFTSExtension(conn)，已加载/已安装等幂等静默；createConnection 改为 async 供上述 await 使用**

#### 四、gitnexus/src/cli

**CLI命令增强：**

1. **index.ts - serve命令增强，默认端口从4747改为6660，新增--embeddings选项**
2. **serve.ts - 服务启动增强，新增embeddings选项支持，默认端口改为6660**
3. **analyze.ts - 分析命令增强，新增JSON格式进度输出（GITNEXUS_PROGRESS），支持filesProcessed和totalFiles字段，调整进度百分比，优化LadybugDB阶段和错误处理**
4. **skill-gen.ts - 技能生成配置化，新增SkillConfig接口和loadSkillConfig函数，支持从.gitnexus/skill-config.json读取配置，社区目录过滤配置化**

#### 五、gitnexus/src/core

**C++解析优化及核心模块增强：** 下列 **每个编号对应一条路径**（同一文件的多次改动已合并为一行）。未写前缀的路径相对于 **`gitnexus/src/core/`**；`docs/`、`AGENTS.md`、`CLAUDE.md`、`gitnexus/src/tools/`、`gitnexus/test/` 等从 **仓库根** 起算。

1. **AGENTS.md / CLAUDE.md** — GitNexus 索引统计数字更新。
2. **docs/CXX_CODERELATION_OPTIMIZATION_PLAN.md** — C++ CodeRelation（CALLS）方案与 §8 落地对照；§8.2（类外 `Class::method` / `findCppCallableQualifiedScopeClassId`）、§8.4（改 worker 依赖源码后须 `npm run build` 同步 `dist`）、§8.6（末尾默认实参、`minimumParameterCount`、§7 修订记录）。
3. **docs/CXX_METHOD_MERGE_AND_PARSE_ORDER.md** — nodeId 参数指纹、`.cpp` 覆盖、`HAS_METHOD` 重载、`CALLS` 与 `lookupExactAllFull`、单测索引。
4. **docs/WORKING_TREE_CHANGES_2026-03-31.md** — 工作区改造摘要；与本文第五节、`utils`/`cpp.test` 表格、build/dist 建议、§8.6 等交叉引用。
5. **embeddings/embedding-pipeline.ts** — 导出 `createVectorIndex`；`semanticSearch` 入口 `await isEmbedderReady()`。
6. **embeddings/embedder.ts** — Hugging Face 镜像（hf-mirror.com）；`isEmbedderReady` async（内部 init + `createVectorIndex`）。
7. **embeddings/types.ts** — `maxSnippetLength` 注释（片段长度与算力）。
8. **graph/graph.ts** — C++ Method/Constructor 同 id：`.cpp`/`.cc`/`.cxx` 后写入覆盖；重载靠参数指纹；非 C++ 仍先写入者优先。
9. **graph/types.ts** — `NodeProperties.minimumParameterCount`（Method 签名元数据）。
10. **ingestion/call-processor.ts** — Laravel `guessedId` 用 controller classId；C++ 缓存未命中时 strip 导出宏；`processCalls` 顺序、`remapCppCallableSourceId`、`resolveCallTarget`（`qualifierTypeName`、`callerOwnerClassId`、`lookupMemberFieldType` 补 `receiverTypeName`）、调试日志；`symbolArityAcceptsArgCount`、`filterCallableCandidates` 区间匹配、`formatCandidateBrief` 区间展示。
11. **ingestion/community-processor.ts** — 社区目录过滤扩展（含 app、helper）。
12. **ingestion/constants.ts** — Tree-sitter 缓冲 512KB→2MB。
13. **ingestion/cpp-export-macro-preprocess.ts** — 新增：解析前 strip 导出宏，供 parse-worker / parsing-processor / call-processor / heritage / import。
14. **ingestion/filesystem-walker.ts** — 单文件大小限制 512KB→2MB。
15. **ingestion/heritage-processor.ts** — 缓存未命中时 C++ strip 导出宏。
16. **ingestion/import-processor.ts** — 同上。
17. **ingestion/parsing-processor.ts** — C++ 构造/声明/定义区分、`enclosingClassId` 与 class-scoped nodeId、`#hashCppCallableOverloadSegment`、Method 提升、class/struct 无 filePath id、strip 宏；C++ Property `description` JSON 与 `fieldType` 注册；顺序路径图节点与 `symbolTable.add` 透传 `minimumParameterCount`。
18. **ingestion/pipeline.ts** — 进度优化；`GITNEXUS_LOG_PARSE_ORDER` / `GITNEXUS_PROGRESS` 时写 `parse-order.log`（含 chunk 注释），可 `GITNEXUS_LOG_PARSE_ORDER=0` 关闭。
19. **ingestion/resolution-context.ts** — Tier 1 使用 `lookupExactAllFull` 支撑重载。
20. **ingestion/symbol-table.ts** — 同文件同名多定义、`lookupExactAllFull`、`add` 按 `nodeId` 更新 global；`memberFieldIndex`、`lookupMemberFieldType`、`fieldType`；`minimumParameterCount` 与同 `nodeId` 合并（保留 min、`parameterCount` 取 max）。
21. **ingestion/tree-sitter-queries.ts** — C++ 类名/类内方法/析构/指针返回/内联成员体等 CPP_QUERIES；类内数据成员 `field_declaration` 与 `@prop.type`；`field_expression` 注释。
22. **ingestion/type-env.ts** — `lookupWithMemberFields` 跨文件成员类型。
23. **ingestion/utils.ts** — `findEnclosingClassId`（qualified、无 filePath classId）；`hashCppCallableOverloadSegment` / `cppParameterListFingerprint`；`cppInClassCallableLabel`；`GITNEXUS_DEBUG_CALLS` / `GITNEXUS_DEBUG_CALLS_NAME`；`findCppCallableQualifiedScopeClassId`（类外 `Class::method`，§8.2）；`MethodSignature.minimumParameterCount`、`cppFormalParameterHasDefault`、`cppMinimumArgCountFromParameterNodes`、`extractMethodSignature` 扩展（§8.6）。
24. **ingestion/workers/parse-worker.ts** — 与 parsing-processor 对齐的 C++ ingest（声明/定义、class-scoped id、重载 hash、effectiveLabel、strip 宏）；`findEnclosingFunctionId`；`ExtractedCall` 的 `line`、`qualifierTypeName`；Property `description`/`fieldType`；`minimumParameterCount` 透传。
25. **lbug/csv-generator.ts** — 截断与 `MAX_FILE_CONTENT` 200000→600000；FileContentCache 注释。
26. **lbug/lbug-adapter.ts** — `closeLbugForPath`、embedding 表名、`BACKTICK_TABLES`、`escapeTableName`；FTS `loadFTSExtension` 幂等；`createConnection` async。
27. **search/hybrid-search.ts** — `mergeWithRRF` 同路径语义元数据只累加 RRF、不覆盖 score/行号等。
28. **gitnexus/src/tools/convert_to_csv.py** — 分页 MATCH `ORDER BY`；JSON 解析失败统计与告警。
29. **gitnexus/debug-\*.mjs、gitnexus/scripts/repro-call-resolution-debug.mjs** — 可选本地调试脚本（未跟踪时可 .gitignore）。
30. **gitnexus/test/fixtures/lang-resolution/** — 未跟踪：cpp-member-field / cpp-qualified-call / cpp-member-samefile-name-collide / cpp-call-resolution-debug-repro 等夹具。
31. **gitnexus/test/fixtures/mini-repo/** — 未跟踪迷你仓库夹具。
32. **gitnexus/test/integration/resolvers/cpp.test.ts** — 同文件碰撞、成员字段、限定调用；`TZmdbMigration::SetIPAndPort` 体内 CALLS `sourceId` 与 `Method:Class:TZmdbMigration:SetIPAndPort#` 对齐。
33. **gitnexus/test/integration/tree-sitter-languages.test.ts** — 类内指针/引用返回带函数体成员捕获。
34. **gitnexus/test/unit/call-processor.test.ts** — 含 `Connect` + `minimumParameterCount` 的 4 实参消解单测。
35. **gitnexus/test/unit/graph.test.ts** — C++ `.cpp`/`.cc`/`.cxx` 覆盖与双 `.cpp` 同 id。
36. **gitnexus/test/unit/ingestion-utils.test.ts** — `cppInClassCallableLabel`。
37. **gitnexus/test/unit/method-signature.test.ts** — 重载 hash、默认参与指纹、类内外一致；5 形参+末尾默认的 `minimumParameterCount`；类外定义无 min。
38. **gitnexus/test/unit/symbol-table.test.ts** — 重载与 `lookupExactAllFull`；`minimumParameterCount` 头/源注册顺序合并。
39. **gitnexus/test/unit/type-env.test.ts** — Mock `lookupExactAllFull`。

#### 六、gitnexus-web/src/lib

**C++场景增强：**

1. **constants.ts - 节点类型和样式配置扩展，新增Struct和Macro节点类型支持，扩展可过滤标签（Struct、Enum、Macro），CONTAINS关系颜色从深绿色改为黄色**
2. **graph-adapter.ts - 图形渲染适配器，CONTAINS关系颜色从深绿色改为黄色，与constants.ts保持一致**

#### 七、gitnexus-web/src/types

**Pipeline类型增强：**

1. **pipeline.ts - PipelineResult和SerializablePipelineResult接口增强，新增lbugReady字段标识LadybugDB/KuzuDB加载状态，serializePipelineResult和deserializePipelineResult函数支持传递数据库就绪状态**

#### 八、gitnexus-web/src/workers

**Worker功能增强：**

1. **ingestion.worker.ts** — `loadSettings` 与递归限制；HTTP API 去掉 `/api` 前缀（`/query`、`/search`）；`runPipeline` / `runPipelineFromFiles` 的 `lbugReady` 与错误日志；`chatStream` 的 `recursionLimit`（参数 > 设置 > 默认 100）；`normalizeBackendBaseUrl`；`/search` 解析 `body.results` 并映射 sources、score、rank、bm25Score、semanticScore。

#### 九、gitnexus-web/src/services

**服务层功能增强：**

1. **server-connection.ts** — `cloneAnalyzeOnServer`（clone-analyze、token/分支、流式、已存在、文件进度）；`uploadZipAnalyzeOnServer`（ZIP≤500MB、流式）。
2. **git-clone.ts** — `parseGenericGitUrl`；`cloneGenericGitRepository`（代理、token）；`createProxiedHttpForLocal` / `createHttpWithToken`；代理 URL 自动补全 `/api/proxy`。
3. **backend.ts** — 默认端口 4747→6660。
4. **saved-queries-service.ts** — 新增：Cypher 查询持久化（localStorage）、内置与用户自定义查询。

#### 十、gitnexus-web/src/hooks

**Hooks功能增强：**

1. **useAppState.tsx - 应用状态管理增强，新增serverRepoName状态、setEmbeddingError、initializeBackendAgent、clearAgentError方法，runQuery和isDatabaseReady支持Server模式，sendChatMessage支持递归限制和Embedding状态检查，switchRepo支持状态清理和Backend Agent**
2. **useSigma.ts - 图形可视化Hook增强，新增autoLayoutOnSetGraph选项控制布局，focusNode方法新增force参数和聚焦逻辑优化**
3. **useBackend.ts - 默认URL从4747改为6660，与CLI服务端口保持一致**

#### 十一、gitnexus-web/src（App 与 components）

**应用壳与组件功能增强：**

1. **App.tsx - Local Git 的 `cloneAnalyzeOnServer` + `connectToServer` 逻辑上收至应用层；移除浏览器内 GitHub 克隆后的 WASM 流水线入口（原 `handleGitClone` / `runPipelineFromFiles`）；`handleZipUploadToServer` 与 Local Git 长任务共用 `longOpAbortRef` + `loadingAllowCancel`，向 `LoadingOverlay` 传入可选取消；ZIP/克隆任务 `AbortError` 时回到 onboarding 并清空进度；`handleServerConnect` 提前声明以满足 hooks 依赖顺序；`DropZone` 改为 `onLocalGitSubmit` 回调**
2. **DropZone.tsx - 移除前台 GitHub 独立标签页及浏览器内克隆入口（开源/私有统一走 Local Git + serve）；保留 ZIP Upload / Git（Local Git）/ Server 三 Tab；Local Git 校验通过后调用 `onLocalGitSubmit` 交由 App 切换 `loading`；ZIP 填写代理后上传不再在组件内嵌进度页，与本地选 ZIP 相同由全屏 `LoadingOverlay` 展示；精简状态与 import（去掉组件内 clone-analyze 进度映射）；Server Tab 说明去掉「必须用 GitHub 标签克隆公开库」类表述**
3. **LoadingOverlay.tsx - 新增可选 `onCancel`，在长任务（ZIP 上传、Local Git）期间显示「取消」并触发 `AbortController.abort`；`progress.phase === 'error'` 时不显示取消**
4. **GraphCanvas.tsx - 图形画布组件增强，节点点击聚焦增强，Ref暴露增强使用双重requestAnimationFrame延迟调用和force参数，聚焦选中节点增强**
5. **QueryFAB.tsx - Cypher查询浮动按钮组件增强，查询保存功能（localStorage），内置查询从5个扩展到13个（中文标签），结果分页功能（50条/页），保存查询UI和查询列表UI改进，表格单元格超长内容悬停显示完整内容（title tooltip）**
6. **RightPanel.tsx - 右侧面板组件增强，递归限制配置功能，错误处理改进（可关闭错误提示），LLM设置集成，状态栏布局改进**
7. **SettingsPanel.tsx - 设置面板组件增强，模型搜索功能（SearchableModelCombobox），OpenAI和Ollama模型加载功能，OpenRouter模型选择改进，后端URL默认值从4747改为6660**
8. **ToolCallCard.tsx - 工具结果预览上限 3000→6000 字符；提示仅页面截断、完整结果仍在上下文**

#### 十一点五、gitnexus-web/src/utils

**进度与上游 API 对齐：**

1. **clone-analyze-progress.ts（新增）- `getCloneAnalyzePhaseLabel`、`cloneAnalyzeProgressFromServer`：将服务端 clone-analyze SSE 阶段（含 `phase|filesProcessed|totalFiles`）映射为 `PipelineProgress`，使全屏加载页与本地 WASM 解析流水线展示风格一致**

#### 十二、gitnexus-web/src/core

**C++场景支撑、大模型操作优化及界面优化：**

1. **embeddings/embedder.ts - 浏览器/Worker 内用同源代理避免 CORS；支持使用hf国内直连镜像**
2. **graph/types.ts - C++场景适配节点标签增加结构体和宏**
3. **ingestion/community-processor.ts - 增加社区屏蔽公共目录名称**
4. **ingestion/utils.ts - C++场景适配关联.h及.c文件; findEnclosingClassId新增qualified_identifier处理，类内classId改为不含filePath**
5. **llm/agent.ts - 模型检索增强, 暴露schema数据解构避免检索出错, 过滤空内容, 并支持递归次数配置**
6. **llm/settings-service.ts - 支持模型列表自检索**
7. **llm/tools.ts - 模型检索增强, 暴露schema数据解构避免检索出错, 增强read工具对路径依赖的限制；read 工具 MAX_CONTENT 50,000→200,000→600,000；Cypher 使用 labels(n) 与 ORDER BY 列别名；explore/context 按节点类型安全构造 MATCH（反引号转义标签名）或 MATCH (n {id})；labels() 返回数组时成员列表 formatLabelsForDisplay 与 normalizeNodeType 解析（多标签节点 MATCH 仍取首个合法标签，属折中）**
8. **llm/types.ts - 大模型递归次数限制可配置**
9. **lbug/csv-generator.ts - 文件截断大小优化；File 节点 MAX_FILE_CONTENT 200000→600000（与 CLI 侧及 read 工具上限对齐）**
10. **ingestion/tree-sitter-queries.ts - C++类名声明解析优化, 排除构造函数及前向声明; CPP_QUERIES补全类内方法声明捕获规则（field_identifier、pointer_declarator、析构函数declaration）**


