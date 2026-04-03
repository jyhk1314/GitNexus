# C++ Process 追踪：仅沿 Function / Method 扩展

## 1. 背景

GitNexus 在 **Process 检测**（`process-processor.ts`）中，从入口点沿 **`CALLS`** 边做 BFS，生成执行流（`trace`）、`entryPointId` / `terminalId` 等，供图谱与 Agent 使用。

**CALLS 消解**（`call-processor.ts`）侧对 C++ 允许将调用解析到 **Macro**、**Constructor**、合成 **Class** 边等多种目标，以尽量还原代码关系。这些边对「谁调用了谁」有意义，但若 **原样进入 Process 追踪**，会出现：

- 路径穿过 **Macro**、**Class** 等非「函数调用语义」节点，`terminalId` 与步骤序列对「业务流」解读价值下降；
- 与「入口点仅限 Function/Method」的直觉不一致（入口已过滤，中段仍可能落入 Macro）。

本方案 **不改变 CALLS 建边**，仅在 **Process 检测阶段**、且 **仅当调用方属于 C++** 时，对 **向前追踪用的出边** 做收窄。

## 2. 目标

| 项目 | 说明 |
|------|------|
| 范围 | **仅 C++**：判断依据为节点 `properties.language === SupportedLanguages.CPlusPlus`（`cpp`）。 |
| 行为 | 对 **当前节点为 C++ 符号** 时，从 `CALLS` 邻接表中 **只保留** 目标标签为 **`Function` 或 `Method`** 的边；其它语言 **保持原样**（仍使用完整出边列表，含低置信度已由 `MIN_TRACE_CONFIDENCE` 过滤）。 |
| 非目标 | 不在本阶段修改 `call-processor`、符号表或 Macro 索引规则。 |

## 3. 实现要点

### 3.1 辅助逻辑

- **`CPP_TRACE_CALLEE_LABELS`**：`Function`、`Method`。
- **`isCppSymbolNode`**：`language === cpp`。
- **`getCalleesForProcessTrace(sourceId, callsEdges, nodeMap)`**：
  - 若 `sourceId` 对应节点 **不是** C++：返回该点在 `callsEdges` 中的全部目标（与改造前一致）。
  - 若是 C++：仅返回目标节点标签 ∈ `CPP_TRACE_CALLEE_LABELS` 的 id。

### 3.2 与入口点、BFS 的一致性

- **`findEntryPoints`**：判断「是否有至少一条可向前追踪的出边」、以及参与 `calculateEntryPointScore` 的 **callee 数量** 时，对 C++ 节点使用 **`getCalleesForProcessTrace`**，避免「仅有 Macro 等出边」仍被当成有效入口。
- **`traceFromEntryPoint`**：每一步扩展时使用同一函数，保证 **入口筛选与路径扩展** 规则一致。

### 3.3 与其它语言、其它节点类型

- **非 C++**（如 TypeScript/JavaScript）：不应用 callee 标签过滤，行为与改造前相同。
- **C++ 下不沿 Constructor 追踪**：按「只关心 Function/Method」的约定，Constructor 不作为 Process 路径上的可扩展目标；若需将构造函数纳入执行流，需单独开需求并调整 `CPP_TRACE_CALLEE_LABELS`。

## 4. 涉及文件

| 路径 | 说明 |
|------|------|
| `gitnexus/src/core/ingestion/process-processor.ts` | 主实现：`getCalleesForProcessTrace`、`findEntryPoints` / `traceFromEntryPoint` 入参 `nodeMap`。 |
| `gitnexus-web/src/core/ingestion/process-processor.ts` | 与 CLI 包逻辑对齐，便于 Web 端本地/WASM 流水线一致。 |
| `gitnexus/test/unit/process-processor.test.ts` | 回归：C++ `main` 同时存在 `CALLS→Macro` 与 `CALLS→Function` 时，`trace` 仅包含 Function 链。 |

与上游/本仓库其余差异的 **按文件汇总** 见仓库根目录 **`DIFF.md`**（撰写约定：同一路径合并为一条说明）。

## 5. 验证建议

- 运行：`npx vitest run test/unit/process-processor.test.ts`（在 `gitnexus` 目录下）。
- 全量分析后 spot-check：任选 C++ 仓库，确认 Process 步骤中不再出现 `Macro:` / `Class:` 等作为中段或终点（在仅有 Macro 出边的函数上应不再生成无效长链）。
