# Difflog

本文档记录当前仓库版本与原分支的差异点, 部分个性化需求不会再往原分支主动同步

## 与 https://github.com/abhigyanpatwari/GitNexus v1.4.0 差异内容分析:

### 后台服务

#### 一、gitnexus/scripts

**中文本地化支撑：**

1. **convert_to_utf8.py - gitnexus下载仓库后自动转换所有字符集到UTF8**

#### 二、gitnexus/src/server

**核心功能增强及新增API端点：**

1. **api.ts - 表名转义处理，添加BACKTICK_TABLES集合和escapeTableName函数，确保Cypher查询中特殊表名（Struct、Enum、Macro等）能正确执行**
2. **api.ts - createServer函数增强，新增embeddings选项参数，支持在启动时启用embeddings功能**
3. **api.ts - POST /api/repos/clone-analyze，一键克隆并分析仓库，支持token认证、分支指定、流式响应、UTF-8编码转换、智能进度跟踪、已存在场景处理**
4. **api.ts - POST /api/repos/zip-upload-analyze，ZIP上传并分析，支持最大500MB、自动处理单层目录、自动git init、UTF-8编码转换、流式响应**
5. **api.ts - GET/POST /api/proxy，Git代理服务，为Web端Local Git提供代理转发解决跨域和鉴权问题**
6. **api.ts - 数据库连接管理，分析完成后调用closeLbugForPath释放文件锁，避免后台服务持有数据库连接**
7. **api.ts - 导入依赖扩展，新增文件系统操作、进程管理、ZIP处理等功能**
8. **api.ts - 错误处理和日志优化，更详细的错误处理、过滤噪音日志、完善流式响应错误处理**
9. **api.ts - 路径处理工具函数，getCodeBaseDir、getCodeDir、getRepoNameFromUrl、pathEquals等跨平台路径处理**
10. **mcp-http.ts - DELETE /api/mcp/sessions/:sessionId，手动清理 MCP session 接口，支持按 sessionId 关闭并移除会话，成功返回 204，不存在返回 404**
11. **api.ts - 混合搜索分支使用 await isEmbedderReady()，与异步嵌入就绪检查对齐**

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

**C++解析优化及核心模块增强：**

1. **embeddings/embedder.ts - 中文本地化支撑，添加Hugging Face镜像站配置（hf-mirror.com），避免直连慢或不可用；isEmbedderReady 改为 async，内部 initEmbedder 与 createVectorIndex 后再返回是否就绪（每次 semanticSearch 会 await，依赖底层幂等；若延迟敏感可后续做就绪缓存）**
2. **ingestion/community-processor.ts - 社区检测优化，扩展通用目录过滤列表，新增app和helper目录名**
3. **ingestion/constants.ts - Tree-sitter缓冲区大小优化，从512KB提升到2MB，避免跳过较大文件**
4. **ingestion/filesystem-walker.ts - 文件大小限制优化，从512KB提升到2MB**
5. **lbug/lbug-adapter.ts - 数据库适配器，包含closeLbugForPath、getEmbeddingTableName、BACKTICK_TABLES、escapeTableName等功能；queryFTS/createFTSIndex 路径 ensure loadFTSExtension()，模块级 ftsLoaded 幂等**
6. **ingestion/parsing-processor.ts - 进度优化, 解决C++构造函数识别成Function的问题; C++ 排除函数声明：AST node type 为 declaration 时跳过，仅保留 function_definition；C++ HAS_METHOD关系完整性修复：将enclosingClassId计算移至nodeId生成之前，有enclosingClassId时用其替代filePath作为scope key，使.h声明和.cpp定义合并为同一图节点；类作用域 Method/Constructor 的 nodeId 在 `scope:name` 后追加 `#` + `hashCppCallableOverloadSegment`（仅各形参 type 子树指纹，SHA256 截断 12 位），区分重载且头/源默认实参声明与定义仍可 id 一致；C++ Function节点有所属类时label提升为Method；C++ class/struct节点使用不含filePath的id；C++解析前预处理：strip class/struct前的导出宏（DLL_API、DLL_SQLPARSE_API、DLLEXPORT）**
7. **ingestion/pipeline.ts - 进度优化**
8. **lbug/csv-generator.ts - 文件截断大小优化；FileContentCache 默认 maxSize=3000 及最大缓存节点数注释；File 节点导出内容上限 MAX_FILE_CONTENT 200000→600000**
9. **ingestion/tree-sitter-queries.ts - C++类名声明解析优化, 排除构造函数及前向声明; C++ CPP_QUERIES补全类内方法声明捕获：修复field_declaration规则中identifier→field_identifier/operator_name，新增pointer_declarator包裹的返回指针方法规则，新增类内析构函数declaration规则；field_declaration_list 内补全「指针/双重指针/引用返回且带函数体」的内联成员 function_definition 捕获（与文件域模式对齐）**
10. **ingestion/workers/parse-worker.ts - 解决C++构造函数识别成Function的问题; C++ 排除函数声明：AST node type 为 declaration 时跳过，仅保留 function_definition；C++ HAS_METHOD关系完整性修复：enclosingClassId提前计算，nodeId scope改为class-scoped；类作用域 Method/Constructor 同步追加 `#` + `hashCppCallableOverloadSegment` 重载段（与 parsing-processor 一致）；effectiveLabel机制（Function→Method提升）；findEnclosingFunctionId同步使用class-scoped id；C++ class/struct使用不含filePath的nodeId；C++解析前预处理：strip class/struct前的导出宏（DLL_API、DLL_SQLPARSE_API、DLLEXPORT）**
11. **ingestion/utils.ts - C++ HAS_METHOD关系完整性修复：findEnclosingClassId新增qualified_identifier处理，从out-of-line方法定义（ClassName::method）的scope提取类名，返回不含filePath的classId；类内方法的classId也改为不含filePath，使.h和.cpp两侧id一致；新增 `hashCppCallableOverloadSegment` / `cppParameterListFingerprint`：仅拼接各形参 `type` 子树文本（规范化空白），忽略形参名与默认实参，兼容 `parameter_declaration` 与 `optional_parameter_declaration`，供类作用域 Method/Constructor 的 nodeId 重载消歧**
12. **ingestion/call-processor.ts - C++ HAS_METHOD关系完整性修复：Laravel路由猜测的guessedId改为用controller的nodeId（classId）作为scope，与class-scoped nodeId方案保持一致；C++解析前预处理：缓存未命中时strip class/struct前的导出宏**
13. **ingestion/cpp-export-macro-preprocess.ts - 新增文件，C++解析前strip导出宏（DLL_API、DLL_SQLPARSE_API、DLLEXPORT），解决tree-sitter-cpp无法解析class MACRO Type的问题，preprocessCppExportMacros供parse-worker、parsing-processor、call-processor、heritage-processor、import-processor调用**
14. **ingestion/heritage-processor.ts - C++解析前预处理：缓存未命中时strip class/struct前的导出宏**
15. **ingestion/import-processor.ts - C++解析前预处理：缓存未命中时strip class/struct前的导出宏**
16. **embeddings/embedding-pipeline.ts - 导出 createVectorIndex；semanticSearch 入口 await isEmbedderReady()**
17. **embeddings/types.ts - maxSnippetLength 配置项注释（片段长度与算力权衡）**
18. **search/hybrid-search.ts - mergeWithRRF：同一路径已写入语义元数据时，后续语义命中只累加 RRF 分，不覆盖 semanticScore、nodeId、行号等**
19. **graph/graph.ts - C++ Method/Constructor 同 id 合并策略优化：后写入若来自 `.cpp`/`.cc`/`.cxx` 且 `language=cpp`，则覆盖图中已有节点（含早前 `.h` 或另一 `.cpp`）；重载在解析层通过参数类型指纹区分 id；`nodeId` 不变时 `HAS_METHOD` 仍指向同一方法节点；非 C++ 或其它标签仍为「先写入者优先」**
20. **ingestion/pipeline.ts - 解析顺序可观测：满足 `GITNEXUS_LOG_PARSE_ORDER` 或与 clone-analyze 一致的 `GITNEXUS_PROGRESS` 时，写入 `<repo>/.gitnexus/parse-order.log`（含 chunk 范围注释）；`GITNEXUS_LOG_PARSE_ORDER=0` 可显式关闭；stderr 输出绝对路径便于 serve/clone-analyze 排查**
21. **test/unit/graph.test.ts - 覆盖 C++ 实现文件覆盖声明侧节点、`.cc`/`.cxx` 后缀，及「两个 `.cpp` 同 id 时后者覆盖」**
22. **ingestion/symbol-table.ts - 同文件同名支持多条定义（重载）：fileIndex 改为 `SymbolName → SymbolDefinition[]`；新增 `lookupExactAllFull`；`add` 同 `nodeId` 时替换条目；`lookupExact` / `lookupExactFull` 返回列表首条以兼容原语义；globalIndex 按 `nodeId` 去重更新**
23. **ingestion/resolution-context.ts - 同文件权威层（Tier 1）改用 `lookupExactAllFull`，候选返回该文件内同名全部定义，支撑重载解析**
24. **docs/CXX_METHOD_MERGE_AND_PARSE_ORDER.md - 设计与实现对齐说明：nodeId 含参数类型指纹、`.cpp` 后写入覆盖规则、HAS_METHOD 重载多条、`CALLS` 与 `lookupExactAllFull` 关系、单测/集成测索引**
25. **test/unit/method-signature.test.ts - `hashCppCallableOverloadSegment`：重载分段不同、空参稳定、默认实参声明与无默认定义指纹一致、类内 `optional_parameter` 与类外 `function_definition` 一致**
26. **test/integration/tree-sitter-languages.test.ts - 类内指针/双重指针/引用返回且带函数体的成员方法捕获**
27. **test/unit/symbol-table.test.ts - 同文件同名多 overload 保留与 `lookupExactAllFull` 长度断言**
28. **test/unit/type-env.test.ts - Mock SymbolTable 补充 `lookupExactAllFull`**
29. **ingestion/tree-sitter-queries.ts（追加）- CPP_QUERIES 新增类体内非函数 `field_declaration` 数据成员捕获（普通/指针/引用 declarator）、`@prop.type`；注释说明 `obj.method` 与 `obj->method` 均对应 field_expression**
30. **ingestion/parsing-processor.ts（追加）- C++ Property：`description` JSON（`ownerId`、归一化 `fieldType`）；符号表注册 `fieldType`；worker 合并路径透传 `fieldType`**
31. **ingestion/symbol-table.ts（追加）- `memberFieldIndex`（`ownerClassId`×字段名→`fieldType`）；`lookupMemberFieldType`；`SymbolDefinition` / `add` 元数据支持 `fieldType`**
32. **ingestion/type-env.ts - `lookupWithMemberFields`：单文件 `lookupInEnv` 未命中时，按外围类名查 Class/Struct 再 `lookupMemberFieldType`，跨文件补成员变量静态类型（如 .h 声明、.cpp 方法体内使用）**
33. **ingestion/utils.ts（追加）- `cppInClassCallableLabel`（类内 `Function`→`Method` 与 ingest 一致）；`getCallResolutionDebugMode` / `getCallResolutionDebugNameFilter`（环境变量 `GITNEXUS_DEBUG_CALLS`、`GITNEXUS_DEBUG_CALLS_NAME`）**
34. **ingestion/workers/parse-worker.ts（追加）- `findEnclosingFunctionId` 对 C++ 类内 Method/Constructor 追加 `#hashCppCallableOverloadSegment` 与 `cppInClassCallableLabel`；`ExtractedCall` 增加 `line`、`qualifierTypeName`；C++ Property 与顺序路径一致的 `description`/`fieldType`**
35. **ingestion/call-processor.ts（扩展）- C++ CALLS：`processCalls` 先解析调用方再 `resolveCallTarget`；`remapCppCallableSourceId`；`resolveCallTarget` 支持 `qualifierTypeName` 收窄、`callerOwnerClassId` 多候选时优先同 `ownerId`；`lookupMemberFieldType` 补全 member 调用的 `receiverTypeName`；顺序路径抽取限定名与调试日志**
36. **test/unit/ingestion-utils.test.ts - `cppInClassCallableLabel` 单测**
37. **test/integration/resolvers/cpp.test.ts - 集成：同文件短名碰撞（`cpp-member-samefile-name-collide`）、跨文件成员字段（`cpp-member-field`）、限定调用（`cpp-qualified-call`）**
38. **src/tools/convert_to_csv.py - 内嵌导出脚本：节点 / CodeRelation / CodeEmbedding 分页 MATCH 增加 ORDER BY（稳定 SKIP/LIMIT）；stdout JSON 行解析失败计数与 stderr 告警**
39. **AGENTS.md / CLAUDE.md - GitNexus 索引统计数字更新**
40. **docs/CXX_CODERELATION_OPTIMIZATION_PLAN.md - C++ CodeRelation（CALLS）优化方案与 §8 已落地实现对照**
41. **docs/WORKING_TREE_CHANGES_2026-03-31.md - 工作区未提交改造摘要（与本文档第五节新增条目交叉引用）**
42. **test/fixtures/lang-resolution/** - 未跟踪：`cpp-member-field`、`cpp-qualified-call`、`cpp-member-samefile-name-collide`、`cpp-call-resolution-debug-repro` 等最小复现工程（提交后集成测可移植）**
43. **gitnexus/debug-*.mjs、gitnexus/scripts/repro-call-resolution-debug.mjs - 未跟踪：本地调用消解调试脚本（可选入库或 .gitignore）**
44. **gitnexus/test/fixtures/mini-repo/** - 未跟踪：迷你仓库夹具（含 `.claude/skills`、`AGENTS.md`、`CLAUDE.md`）**

#### 六、gitnexus-web/src/lib

**C++场景增强：**

1. **constants.ts - 节点类型和样式配置扩展，新增Struct和Macro节点类型支持，扩展可过滤标签（Struct、Enum、Macro），CONTAINS关系颜色从深绿色改为黄色**
2. **graph-adapter.ts - 图形渲染适配器，CONTAINS关系颜色从深绿色改为黄色，与constants.ts保持一致**

#### 七、gitnexus-web/src/types

**Pipeline类型增强：**

1. **pipeline.ts - PipelineResult和SerializablePipelineResult接口增强，新增lbugReady字段标识LadybugDB/KuzuDB加载状态，serializePipelineResult和deserializePipelineResult函数支持传递数据库就绪状态**

#### 八、gitnexus-web/src/workers

**Worker功能增强：**

1. **ingestion.worker.ts - 导入依赖扩展，新增loadSettings用于读取用户配置的递归限制等设置**
2. **ingestion.worker.ts - HTTP API路径调整，去掉/api前缀（/query、/search），与后端服务路由保持一致**
3. **ingestion.worker.ts - runPipeline和runPipelineFromFiles方法增强，新增lbugReady状态跟踪，添加错误日志输出，返回时传递数据库加载状态**
4. **ingestion.worker.ts - chatStream方法增强，新增recursionLimit参数支持，实现优先级：参数 > 用户设置 > 默认值100**
5. **ingestion.worker.ts - normalizeBackendBaseUrl 规范化粘贴型后端 URL；HTTP /search 解析 body.results 数组（非数组时按空数组），映射 sources、score、rank、bm25Score、semanticScore 等**

#### 九、gitnexus-web/src/services

**服务层功能增强：**

1. **server-connection.ts - 新增cloneAnalyzeOnServer函数，通过后端clone-analyze API拉取Git仓库并建索引，支持token认证、分支指定、流式响应、已存在场景处理、文件数量进度信息**
2. **server-connection.ts - 新增uploadZipAnalyzeOnServer函数，通过后端zip-upload-analyze API上传ZIP文件并建索引，支持最大500MB、流式响应、已存在场景处理**
3. **git-clone.ts - 新增parseGenericGitUrl函数，解析任意Git URL（不仅限于GitHub）**
4. **git-clone.ts - 新增cloneGenericGitRepository函数，克隆任意Git仓库（私有/内网/自托管），支持代理模式和token认证**
5. **git-clone.ts - 新增createProxiedHttpForLocal和createHttpWithToken辅助函数，支持代理转发和token认证**
6. **git-clone.ts - 代理路径自动补全，如果proxyUrl不是以/api/proxy结尾则自动补全**
7. **backend.ts - 默认端口从4747改为6660，与CLI服务端口保持一致**
8. **saved-queries-service.ts - 新增文件，保存的查询服务，持久化用户Cypher查询到localStorage，支持内置查询和用户自定义查询**

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


