# C++ CALLS：按 Method 所属类补全「直接指向 Class」的边

## 1. 背景与问题

解析管线会为调用点生成 `CALLS` 边，目标多为 **Method**（如 `Method:Class:TZmdbStrFunc:StrCmpNoCase#…`）或 **Constructor**，有时也会因 `new`、`构造` 等已有 **直接指向 Class** 的边（如 `Class:TZmdbCCryptDES`）。

在同一 **fromId**（调用方）下，若已经出现「对某类成员方法的调用」，但 **尚未**出现「对该类节点本身的 CALLS」，则下游图分析、依赖展示或导出 CSV 时，会表现为：**缺少对该类的直接引用边**，与「已调用该类能力」的语义不完全一致。

本方案在 **不改变原有消解结果** 的前提下，用一次 **后处理** 补全缺失的 **`CALLS → Class:Owner` / `Struct:Owner`** 边。

## 2. 适用范围（约束）

| 约束 | 说明 |
|------|------|
| 语言 | 仅 **C++**（调用方、被调 Method/Constructor 按规则判定） |
| 关系类型 | 仅处理 **`CALLS`** |
| 调用方 fromId | **`Function` / `Method` / `Constructor`**，且判定为 C++ 调用方 |
| 触发条件 | 存在 **类作用域** 的 `Method:` / `Constructor:` 目标（id 形态为 `…:Class:…` 或 `…:Struct:…`，而非 TU 文件路径 stem） |
| 补全内容 | 若图上存在 owner 的 **Class/Struct 节点**，且当前 fromId 的 CALLS **尚未**以该 id 为目标，则 **新增** 一条 `CALLS` |

不修改、不删除已有 `CALLS`；已存在 `CALLS → Class:TZmdbX` 时 **不重复**添加。

## 3. 算法说明

对全图所有 `CALLS` 按 **`sourceId`（fromId）** 分组：

1. 若该 `sourceId` 不是 C++ 下的 Function/Method/Constructor 调用方，**跳过**。
2. 构建该调用方当前所有 `CALLS` 的 **`targetId` 集合** `T`。
3. 遍历该组内每条 `CALLS`：
   - 若 `targetId` 不是 **类作用域** 的 `Method:` / `Constructor:`，跳过。
   - 用既有逻辑从 `targetId` 解析 **owner**：`Class:Name` 或 `Struct:Name`（与 `tryCppOwnerClassIdFromCallSourceId` 一致）。
   - 若图上 **不存在** 该 owner 节点，跳过。
   - 若 **`T` 已包含 ownerId**（已有直接指向该类的 CALLS），跳过。
   - 否则将 ownerId 记入「待补全」集合（同一 owner 只补一条）。
4. 对每个待补全的 `ownerId`，**新增** `CALLS`：
   - `targetId = ownerId`
   - `confidence = 0.85`
   - `reason = cpp-method-implies-owner-class`
   - 边 `id` 使用稳定占位 callee 名，避免与真实调用名冲突：`` `<cpp-owner-class>${ownerId}` ``

## 4. C++ 调用方判定（含 Function:path.cpp:name）

- 节点上 **`properties.language === C++`**，或  
- **`properties.filePath`** 经 `getLanguageFromFilename` 为 C++，或  
- **`sourceId`** 形如 `Function:…:funcName`，且从 `Function:` 后、**最后一个 `:`** 之前截取的路径经 `getLanguageFromFilename` 为 C++。

用于覆盖 **`Function:BackServiceCpp/.../DataChange.cpp:ReadMdbDataChangeCfg`** 等 **未写 `language`** 的 Function 节点。

## 5. 落地位置

| 模块 | 职责 |
|------|------|
| `ingestion/call-processor.ts` | 导出 `enrichCppCallsTargetsFromSiblingClassScope(graph: KnowledgeGraph)` |
| `ingestion/pipeline.ts` | 所有 chunk 的 `processCallsFromExtracted` 与顺序回退 `processCalls` **全部完成后**调用一次 |
| `graph/graph.ts`、`graph/types.ts` | （可选能力）`removeRelationship`：供其他场景删边；本补全逻辑 **不依赖** 删边 |

## 6. 测试与构建

- **单元测试**：`gitnexus/test/unit/call-processor.test.ts` — 模拟「已有 Method + 已有 Class A 直接边、缺 Class B 直接边」与「无 language 的 Function:…cpp:…」。
- 修改 `gitnexus/src` 后执行 **`npm run build`** 同步 `dist/`（与仓库内其他 C++ 改动约定一致）。

## 7. 已知边界

- **Struct** 与 **Class** 同等：owner 为 `Struct:X` 时补 `CALLS → Struct:X`。
- 若 owner 节点未进图，**不补**（避免悬空 target）。
- 补全边为 **推导边**，置信度固定 **0.85**，与直接消解边区分。
- **不**根据「单 TU 内唯一 class」去改写 Method 的 `targetId`；仅 **增加** 指向 owner Class/Struct 的 `CALLS`。

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-03-31 | 初版：补全 `CALLS → owner Class/Struct`；纠正早期误实现的「文件路径 Method 合并改写」方案。 |
