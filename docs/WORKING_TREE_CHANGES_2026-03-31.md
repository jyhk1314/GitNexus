# 工作区未提交改造摘要（2026-03-31）

本文档描述当前 Git 工作区内**相对已提交基线**的改造范围，便于评审与合入前对照。条目风格与仓库根目录 [`DIFF.md`](../DIFF.md) 一致：**按路径 + 一句话要点**。详细设计与「已落地」对照见同目录 [`CXX_CODERELATION_OPTIMIZATION_PLAN.md`](./CXX_CODERELATION_OPTIMIZATION_PLAN.md) §8。

## 一、改造目标（一句话）

强化 **C++ 场景下 CodeRelation（`CALLS`）** 的 **fromId / toId** 与图中 **Method** 对齐，并补齐 **跨文件成员字段类型**、**限定调用 `Type::m()`**、**同 TU 同名多候选** 等路径；另修正 **图导出分页** 的无序 SKIP/LIMIT 问题。

## 二、已修改文件（`git diff`）

| 文件 | 要点 |
|------|------|
| `AGENTS.md`、`CLAUDE.md` | 顶部 GitNexus 索引统计更新（symbols / relationships / flows）。 |
| `gitnexus/src/core/ingestion/tree-sitter-queries.ts` | `CPP_QUERIES` 增加类体内**数据成员** `field_declaration`（普通/指针/引用），`@prop.type` 供类型抽取；补充 `field_expression` 与 `->`/`.` 的注释。 |
| `gitnexus/src/core/ingestion/parsing-processor.ts` | C++ `Property`：`description` JSON（`ownerId`、`fieldType` 归一化）；`addSymbol` 传入 `fieldType`。 |
| `gitnexus/src/core/ingestion/symbol-table.ts` | `memberFieldIndex`；`lookupMemberFieldType`；`SymbolDefinition` / `add` 支持 `fieldType`。 |
| `gitnexus/src/core/ingestion/type-env.ts` | `lookupWithMemberFields`：单文件 env 未命中时，按外围类名 + `lookupMemberFieldType` 跨文件解析成员变量类型。 |
| `gitnexus/src/core/ingestion/utils.ts` | `cppInClassCallableLabel`（类内 `Function`→`Method` 与 ingest 一致）；**`findCppCallableQualifiedScopeClassId` + `findEnclosingClassId`**：从 **`function_definition`/`function_declaration`** 的 declarator 解析 **`Class::method`** 的 `qualified_identifier`，修复 **类外成员函数体**内 CALLS 的 **`fromId`/`sourceId`** 与图中 **Method** 节点 id 不一致（详见 [`CXX_CODERELATION_OPTIMIZATION_PLAN.md`](./CXX_CODERELATION_OPTIMIZATION_PLAN.md) §8.2 最后一行）；`getCallResolutionDebugMode`、`getCallResolutionDebugNameFilter`（`GITNEXUS_DEBUG_CALLS` / `GITNEXUS_DEBUG_CALLS_NAME`）。 |
| `gitnexus/src/core/ingestion/workers/parse-worker.ts` | `findEnclosingFunctionId` 与解析阶段对齐（`cppInClassCallableLabel`、Method/Constructor `#overload`）；`ExtractedCall` 增加 `line`、`qualifierTypeName`；C++ `Property` 与顺序路径一致的 `description`/`fieldType`。 |
| `gitnexus/src/core/ingestion/call-processor.ts` | 大规模 C++ CALLS：`processCalls` 顺序调整；`remapCppCallableSourceId`；`resolveCallTarget` 支持限定名、`callerOwnerClassId` 收窄、成员类型补全；顺序路径与调试日志等（与 §8 对照表一致）。 |
| `gitnexus/test/unit/ingestion-utils.test.ts` | `cppInClassCallableLabel` 单元测试。 |
| `gitnexus/test/integration/resolvers/cpp.test.ts` | 集成：`cpp-member-samefile-name-collide`（含 **类外方法** 体内 CALLS 的 **`sourceId`** 断言 **`Method:Class:TZmdbMigration:SetIPAndPort#`**）、`cpp-member-field`、`cpp-qualified-call` 等场景。 |
| `gitnexus/src/tools/convert_to_csv.py` | 内嵌 JS：节点 / `CodeRelation` / `CodeEmbedding` 分页查询增加 **ORDER BY**，避免 SKIP/LIMIT 顺序未定义；stdout JSON 解析失败统计与告警。 |

## 三、未跟踪路径（`git status` 中 `??`）

| 路径 | 说明 |
|------|------|
| `docs/CXX_CODERELATION_OPTIMIZATION_PLAN.md` | C++ CodeRelation 优化方案 + §8 实现对照（建议与代码一并纳入版本库）。 |
| `gitnexus/test/fixtures/lang-resolution/cpp-member-field/` | 跨 `.h`/`.cpp` 成员字段 + `m_user->…` CALLS 回归夹具。 |
| `gitnexus/test/fixtures/lang-resolution/cpp-qualified-call/` | `Logger::emitLogEntry()` 限定调用回归夹具。 |
| `gitnexus/test/fixtures/lang-resolution/cpp-member-samefile-name-collide/` | 同文件同名/Arity 与 receiver 收窄回归夹具。 |
| `gitnexus/test/fixtures/lang-resolution/cpp-call-resolution-debug-repro/` | 调用消解调试复现（若保留需文档说明用途）。 |
| `gitnexus/debug-enclosing.mjs`、`debug-member-field.mjs`、`debug-pipeline.mjs` | 本地调试脚本，通常**不提交**或移至 `scripts/` 并注明用途。 |
| `gitnexus/scripts/repro-call-resolution-debug.mjs` | 同上。 |
| `gitnexus/test/fixtures/mini-repo/` | 迷你仓库夹具（含 `.claude/skills`、`AGENTS.md`、`CLAUDE.md` 等），需确认是否仅为测试/文档样本。 |

## 四、与 `DIFF.md` 的关系

根目录 `DIFF.md` 记录与本仓库上游 **v1.4.0** 的累计差异。本节改造已在 `DIFF.md` **第五节**以 **29–44** 号条目收录（C++ CodeRelation 等）；**类外 `Class::method` 体内 `fromId` 根因修复**另见同节 **45–48** 号条目。

## 五、建议后续动作

1. 将 § 三中**测试夹具**与 **`CXX_CODERELATION_OPTIMIZATION_PLAN.md`** 一并 `git add` 后提交，否则集成测在未跟踪状态下无法在他人环境复现。  
2. 调试脚本明确去留：删除、或加入 `.gitignore`、或收编为 `npm`/`pnpm` 文档中的可选命令。  
3. 合入后按 `AGENTS.md` 说明执行 `npx gitnexus analyze` 刷新索引统计。  
4. 修改 **`utils.ts`** 等 **parse worker** 依赖的源码后执行 **`npm run build`**，否则 **`dist/.../parse-worker.js`** 仍可能加载旧逻辑（见 [`CXX_CODERELATION_OPTIMIZATION_PLAN.md`](./CXX_CODERELATION_OPTIMIZATION_PLAN.md) §8.4）。
