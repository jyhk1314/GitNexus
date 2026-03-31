# C++ 解析与 CodeRelation（CALLS）优化方案

## 1. 背景与目标

### 1.1 问题背景

当前 GitNexus 在 C++ 场景下，**CodeRelation 中 `type: CALLS` 的边不完整**，典型表现包括：

- 类外实现（`.cpp`）中的成员函数体内，对 **`obj->method()` / `obj.method()`** 的调用，常因 **无法从单文件 AST 推断接收者静态类型**，导致无法唯一绑定到目标 **Method**，进而不生成或无法入库 CALLS。
- **`Type::staticMethod()` / `ns::func()`** 等 **限定调用** 在抽取时往往只保留 **末段标识符**（如 `GetInfo`），**未利用左侧类型/作用域名** 收窄符号，全局同名时消解失败。
- **fromId（调用方）** 与图中 **Method** 节点 id 已做过部分对齐（类作用域、重载指纹、`Function`→`Method` 提升等），但 **toId（被调用方）** 仍依赖上述类型与限定信息，缺失时整条边无法成立。

### 1.2 方案目标

完善 C++ 路径下 **类相关的函数/方法调用关系** 的抽取与消解，使 **Method / Function** 作为 **fromId / toId** 时，CALLS 能稳定进入 CodeRelation，并与图中 **Method** 节点正确关联。

---

## 2. 关键点一：类相关变量落到 `Variable` 节点，用 `description` 承载归属与类型

### 2.1 建模约定

将「**静态类型为类（或指向类的指针/引用等，可规范为某一类型名）**」的变量统一建模为图上的 **`Variable`** 节点（与现有 `graph/types.ts` 中的 `Variable` 标签对齐）。

- **`description` 字段编码约定**（实现期可再细化为结构化 JSON，过渡期用约定字符串）：
  - 格式：**`ownerClassId || fieldType`**
    - **`ownerClassId`**：该变量声明所在作用域的「拥有者」在图中的节点 id（例如成员变量所属 **Class/Struct** 的 id；函数内局部变量可为 **Method/Function** 的 id，或约定为空/`file` 级占位，由实现统一）。
    - **`fieldType`**：解析得到的 **类型名字符串**（如 `TZmdbShmDSN`、`*`/`&` 等可在预处理中归一或保留原始片段，需与后续 `ctx.resolve` 所用名称一致）。

> **说明**：当前 Ladybug 的 `Property` 等表结构无专用「所属类 id / 字段类型」列；本方案选用 **`Variable` + `description` 约定** 以降低首轮 schema 改动面。若后续落地，需在 **`schema.ts` / `NODE_TABLES` / `RELATION_SCHEMA`** 中补齐 **`Variable` 节点表** 及与 **Class / Method / File** 的边类型（如 `DEFINES`、`HAS_METHOD` 或新增 `DECLARED_IN` 等），并与 `csv-generator`、`lbug-adapter` 的 COPY 路径对齐。

### 2.2 解析范围（两类来源，均需入库）

| 来源 | 说明 |
|------|------|
| **A. 头文件 / 类定义体内的成员变量** | 从 `.h`（及含完整类体的翻译单元）中 **`class`/`struct` 的 `field_declaration`**（**非**成员函数）解析：变量名、类型、`ownerClassId` = 外围类节点 id。 |
| **B. Method / Function 体内的局部变量** | 在同一套 C++ AST 遍历中，对 **带类类型（或指针/引用）的局部声明** 解析：`ownerClassId` = 所在 **Method/Function** 节点 id（或文件级约定），`fieldType` = 声明类型。 |

两类 **`Variable`** 均应写入符号表（或并行索引），供 **CALLS 消解阶段** 按 **变量名 → 类型名** 查询，以补全 **`m_pShmDSN->GetInfo()`** 等场景的 **`receiverTypeName`**。

### 2.3 与现有能力的关系

- 当前 **CPP tree-sitter 查询** 对 **类内数据成员** 几乎未单独 capture，需 **新增 query + ingest 分支**。
- 现有 **`type-env`** 为 **单文件**、偏 **声明/参数** 抽取；本方案通过 **显式 Variable 节点 + 符号索引** 把「跨 .cpp/.h 可关联」的类型信息 **沉淀到图中**，供 call 处理二次读取。

---

## 3. 关键点二：CodeRelation 处理时全量覆盖 Method / Function，并区分 fromId / toId 语义

### 3.1 遍历范围

在处理 **CodeRelation（CALLS）** 时，需保证：

- **调用方（fromId）**：凡调用发生在 **Method** 或 **Function** 体内，均应能解析到 **图中已存在的** 对应 **Method** 或 **Function** 节点 id（与定义阶段 id 规则一致，含 C++ 类作用域、重载 `#hash`、`Function`→`Method` 提升等）。
- **被调用方（toId）**：消解成功后指向 **Method** / **Function** / **Constructor** 等现有可调用节点（保持与 `call-processor` 中 `filterCallableCandidates` 一致）。

### 3.2 类型区分

- **`fromId`**：明确区分来源符号是 **Method** 还是 **Function**（标签与 id 前缀一致），**禁止** 用错标签导致 Ladybug 端 **COPY** 时端点表不匹配。
- **`toId`**：同样区分 **Method** 与 **Function**（及语言允许的其它 CALLS 目标类型），与 **NODE_TABLES / CodeRelation 的 FROM/TO 组合** 一致，避免静默丢边。

### 3.3 工程注意点

- **worker 路径**（`parse-worker` 抽取 `ExtractedCall`）与 **顺序路径**（`call-processor`）逻辑需 **对齐**（同一套 enclosing id、同一套 callee 消解输入）。
- **Ladybug**：`loadGraphToLbug` 按 **from/to 节点表标签** 分文件 COPY，需保证 **Method↔Method、Method↔Function** 等组合在 **RELATION_SCHEMA** 中均已声明。

---

## 4. 关键点三：toId 消解——统一「带类/作用域上下文」的调用意图，并与 Method 建边

### 4.1 三类调用形态（均需覆盖）

| 形态 | 示例 | 消解要点 |
|------|------|----------|
| **成员访问（指针）** | `xx->method()` | `xx` 解析为 **Variable** 或参数/成员 → 得 **`fieldType`/`receiverTypeName`** → 在 **该类** 上匹配 **Method**（含继承/MRO 若后续扩展）。 |
| **成员访问（对象/引用）** | `xx.method()` | 同上，`field_expression` / 语法差异由 grammar 统一为 **接收者符号 + 方法名**。 |
| **限定/作用域调用** | `Type::method()` / `NS::func()` | 不能只解析 **末段名**；需从 **`qualified_identifier`（及 template 变体）** 提取 **左侧作用域类型名**，先 **`ctx.resolve(类型)`** 再 **`ownerId`/文件** 收窄 **method** 候选，与图中 **Method** 关联。 |

### 4.2 数据流（建议）

1. **抽取阶段**：除 `calledName` 外，增加可选字段，例如 **`qualifierTypeName`**（`Type::` 左侧）、**`receiverSymbol`**（`xx` 的标识符文本）等（具体字段名以实现为准）。
2. **消解阶段**：
   - 有 **receiverSymbol** → 查 **Variable/符号表/参数** → **类型名** → 与现 **`resolveCallTarget` 的 receiver 收窄** 合并。
   - 有 **qualifierTypeName** → **等价于已知接收者类型**，按 **类作用域静态方法** 收窄 **toId**。
3. **唯一性**：仍遵守 **多候选则不发边** 的保守策略；在引入 **限定名 + Variable 类型** 后，唯一性应显著改善。

### 4.3 与现网逻辑的关系

- 在 **`inferCallForm`** 中，C++ **`qualified_identifier`** 当前多视为 **free call**；方案要求 **语义上** 将其提升为 **「带类型作用域的调用」**，在 **消解层** 使用 **左侧类型**，而非仅 **`ctx.resolve(短名)`**。
- **`strncpy` 等 C 库调用** 可继续由 **`isBuiltInOrNoise`** 等规则过滤，与本文 **类调用** 路径正交。

---

## 5. 实施顺序建议（里程碑）

1. **Schema + 流水线骨架**：`Variable` 表、与 Class/Method/File 的关系边、CSV/COPY。
2. **Query + Ingest**：类成员变量 + 局部类类型变量 → **Variable** + `description` 约定。
3. **符号索引**：变量名 → `{ ownerClassId, fieldType }` 或等价结构，供 call 阶段查询。
4. **ExtractedCall 扩展 + `resolveCallTarget`**：限定名、receiver 与 **Variable** 联动。
5. **回归测试**：构造最小 `.h`/`.cpp` 用例（含 `m_pShmDSN->GetInfo()`、`Type::Static()`），断言 **CALLS** 的 **fromId/toId** 与 **Method** id 一致。

---

## 6. 风险与边界

- **模板、依赖名、宏**：类型名可能无法稳定解析，需 **降级**（仅短名、或不发边）。
- **多重继承、ADL**：首轮可只支持 **明确类型 + 显式调用** 的主路径。
- **`description` 拼接**：长期建议改为 **独立列或 JSON**，避免解析歧义。

---

## 7. 文档修订记录

| 日期 | 说明 |
|------|------|
| 2026-03-30 | 初稿：根据 C++ CALLS 缺失问题与三点关键设计整理 |
| 2026-03-31 | 补充「已落地改造点」与实现说明（见 §8）；同日增补 §8.2（类外 **`Class::method`** 体内 **`findEnclosingClassId`** / **`findCppCallableQualifiedScopeClassId`**）与 §8.4（**worker/`dist` 同步**） |
| 2026-03-31 | 增补 §8.6：**C++ 末尾默认实参**与 **`CALLS` 消解的实参个数匹配**（`minimumParameterCount`、符号表合并、`symbolArityAcceptsArgCount`） |

---

## 8. 已落地改造点（实现对照）

以下为当前代码库中与本文档对应的 **实际实现**（便于复盘与后续迭代）。Ladybug 侧仍以 **单表 `CodeRelation` + 多 FROM/TO 组合** 承载 CALLS；**独立 `Variable` 节点表尚未引入**，成员字段用 **`Property` + `description` JSON + `SymbolTable.lookupMemberFieldType`** 等价承载 §2、§3 的索引诉求。

### 8.1 符号与节点 id

| 方案条目 | 实现位置 | 说明 |
|----------|----------|------|
| 成员变量 → `ownerId` + `fieldType` | `parsing-processor.ts` / `parse-worker.ts`（C++ `Property`）、`symbol-table.ts` `memberFieldIndex` | `description` 为 `{"ownerId","fieldType"}`；索引键为 **owner 类节点 id** + **字段名** → **归一化类型名** |
| C++ 类内 Method/Constructor **重载指纹** | `utils.ts` `hashCppCallableOverloadSegment` | 节点 id  stem：`${enclosingClassId}:${name}#${12位hex}` |

### 8.2 CALLS 的 `fromId`（与 Method 节点对齐）

| 问题 | 修复 |
|------|------|
| Worker 抽取的 `ExtractedCall.sourceId` 曾 **缺少 `#overload` 段**，与图中 Method id 不一致，导致 **CALLS 无法挂在 Method 节点上** | `parse-worker.ts` `findEnclosingFunctionId`：对 C++ 且在 `Class`/`Struct` 内的 **Method/Constructor**，在 stem 末尾追加与解析阶段相同的 `#${hashCppCallableOverloadSegment(...)}` |
| 类内成员函数在 AST 上常为 **identifier 声明符**，`extractFunctionName` 得到 **Function**，而入库节点为 **Method** → `sourceId` 以 `Function:` 开头，Ladybug **COPY 在 Function 表找不到端点**，`CodeRelation.fromId` 中看不到 Method | `utils.ts` **`cppInClassCallableLabel`**：C++ 且存在 **`enclosingClassId`** 时把 **Function → Method**（与 `parsing-processor` 的 `effectiveLabel` 一致）；`findEnclosingFunctionId` / `findEnclosingFunction` 均使用调整后的 label |
| 顺序路径 `processCalls` 回退 id 与重载不一致 | `call-processor.ts` `findEnclosingFunction`：优先用 **same-file 符号表** 命中 `expectedId`；否则使用与 worker 相同的 **带重载的 `generateId(label, cppStem)`** |
| **类外成员函数体**（`.cpp` 中 `void Class::foo() { ... }`）内抽取 CALLS 时，向上找到的是 **`function_definition`**；原 **`findEnclosingClassId`** 仅在 **`node.parent === qualified_identifier`**（适用于 **@name** 捕获点）或 **类体内的 `class_specifier`** 上能拿到所属类，**顶层类外定义** 两条都不成立 → **`enclosingClassId` 为空** → **`cppStem` 无法生成** → 回退为 **`Method:<filePath>:<shortName>`**，与解析阶段 **`Method:Class:<ClassName>:<shortName>#<hash>`** 不一致，**fromId 在图中不存在**、Ladybug COPY 丢边；同 TU **多类同名方法** 时也无法再依赖「`resolve` 仅一候选」的偶然正确。 | `utils.ts` **`findCppCallableQualifiedScopeClassId`**：对 **`function_definition` / `function_declaration`**，按与 **`extractFunctionName`** 相同方式展开 **`function_declarator`**（含指针/引用包装、`parenthesized_declarator`），从 **`qualified_identifier`** 取 scope（**`type_identifier` / `identifier` / `namespace_identifier`**，覆盖 `TZmdbMigration::SetIPAndPort` 等）。在 **`findEnclosingClassId`** 中，**C++** 下于「沿父链找容器」**之前**调用。`call-processor` **`findEnclosingFunction`** 与 **`parse-worker`** **`findEnclosingFunctionId`** 均通过 **`findEnclosingClassId`** 自动对齐。**回归**：`test/integration/resolvers/cpp.test.ts` — *C++ member call same-file name collision* 中断言 **`CALLS.sourceId`** 匹配 **`^Method:Class:TZmdbMigration:SetIPAndPort#`**。 |

### 8.3 CALLS 的 `toId`（接收者类型与限定名）

| 方案条目 | 实现位置 | 说明 |
|----------|----------|------|
| `receiverTypeName` + `resolveCallTarget` 收窄 | `call-processor.ts` `resolveCallTarget` | member / qualifier 两路过滤（原 §4） |
| Worker 内 **单文件** `buildTypeEnv` 无法看到头文件中的成员字段类型 | `call-processor.ts` `processCallsFromExtracted` | 在符号表已合并 **Property** 之后，对 C++ **member 调用** 若仍缺 `receiverTypeName`，从 `sourceId` 解析 **外围类 id**（`Method:` / `Constructor:` stem 中的 `Class:*` / `Struct:*`），再调用 **`ctx.symbols.lookupMemberFieldType(ownerId, receiverName)`** 补全类型，再消解 **toId** |
| `qualifierTypeName`（`Type::` 左侧） | `parse-worker.ts` + `call-processor.ts` 抽取/消解 | 限定调用在 `inferCallForm` 中为 free，由 **消解层** 用左侧类型收窄 |
| **同一 TU 内同名符号多候选**（如 `A::f` 与 `B::f` 在同一 `.cpp`）导致 **不发边** | `resolveCallTarget` **步骤 F** | 传入 **`callerOwnerClassId`**（从调用方 `sourceId` 解析所属 `Class`/`Struct`），在仍有多候选时 **优先 `ownerId` 与调用方类一致的 Method/Constructor** |
| **`sourceId` 与图中节点 id 不一致**（声明/定义 AST 指纹偏差等） | `remapCppCallableSourceId` | 若 `graph.getNode(sourceId)` 不存在，则按 **`filePath` + 方法名 + `ownerId`** 在符号表中解析 **已注册的 `nodeId`** 再写入 CALLS |

### 8.3b 顺序路径 `processCalls` 的调用顺序修正

| 问题 | 修复 |
|------|------|
| 原逻辑先 **`resolveCallTarget`（被调）** 再 **`findEnclosingFunction`（调用方）**，C++ 无法把 **调用方所属类** 传入消解 | 先 **`findEnclosingFunction` → `remapCppCallableSourceId` → `callerOwner` → `resolveCallTarget(..., callerOwner)`** |

### 8.4 辅助细节

- **`extractFuncNameFromSourceId`**：从 `sourceId` 取 **方法名** 时 **去掉 `#` 重载段**，以便与 constructor 验证的 **receiver 映射** 键一致。
- **Schema**：`RELATION_SCHEMA` 已包含 **`FROM Method TO Method`** 等组合，无需为 Method↔Method CALLS 单独改表结构。
- **Worker 与 `dist`**：`pipeline.ts` 在存在 **`dist/core/ingestion/workers/parse-worker.js`** 时会加载 **编译后的 worker**（及其依赖的 **`dist/.../utils.js`**）。修改 **`src/core/ingestion/utils.ts`** 等被 worker 引用的模块后，需执行 **`npm run build`**（或保持 `dist` 与 `src` 同步），否则 **parse worker 仍跑旧逻辑**，表现为源码已修但 **CALLS `sourceId` 仍错**。

### 8.5 仍属边界 / 未覆盖

- **局部变量** 的类类型（§2.2 B）仍主要依赖单文件 `type-env`；未单独建 **Variable** 节点表。
- **模板、宏、ADL、多继承** 等仍可能无法唯一消解，与 §6 一致。
- **建议回归**：最小 `.h` + `.cpp` 用例（成员字段 + 类外方法体内 `obj->m()`、`Type::Static()`）在 `test/` 中可做端到端断言（§5 里程碑 5）。

### 8.6 C++ 末尾默认实参与 `CALLS` 实参个数（`minimumParameterCount`）

#### 8.6.1 问题

消解阶段在 **`filterCallableCandidates`** 中曾用 **`parameterCount === argCount`** 过滤候选。C++ 常见模式是：**类内声明**带 **末尾默认实参**（如 `Connect(..., bool bIsAutoCommit=false)`），调用处只传 **4 个实参**；而 **形参个数**在索引里为 **5**。于是 **正确的 `Method` 在 arity 阶段被整批剔除**，`resolve_fail` 的 **`finalSample`** 里只剩其它类上 **恰好为 4 个形参** 的重载，表现为「明明有 `TZmdbLocalDatabase::Connect` 却不在候选列表中」。

根因与 **继承无关**：是 **声明形参个数 / 默认实参** 与 **调用点实参个数** 的匹配规则过严。

#### 8.6.2 方案要点

1. **索引（AST）**  
   - 在 **`extractMethodSignature`**（`utils.ts`）中，对 **仅含** C/C++ 形式参数节点（`parameter_declaration` / `optional_parameter_declaration`）的参数列表，计算可选字段 **`minimumParameterCount`**：  
     - 在 **符合「末尾连续默认」** 的前提下，取 **第一个带默认值的形参的下标**，即调用时至少要传的实参个数（可为 `0`）。  
   - **`cppFormalParameterHasDefault`**：`optional_parameter_declaration`，或 **`parameter_declaration`** 上存在 **`default_value`** 子节点。  
   - 若出现 **非末尾默认**（非法 C++ 排列），则不设置 `minimumParameterCount`，回退为 **仅精确匹配** `parameterCount`，避免误匹配。

2. **头文件声明 vs 类外定义**  
   - **类内声明**里 tree-sitter 常用 **`optional_parameter_declaration`** 表示默认实参，可推出 **`minimumParameterCount`**。  
   - **类外 `Class::Connect(...) { }` 定义**里往往只有 **`parameter_declaration`** 且 **AST 中不含默认值**，单独解析时 **`minimumParameterCount` 为 `undefined`**。  
   - **`symbol-table.ts` 的 `add`**：对 **同一 `nodeId`（同名重载指纹一致）** 的多次注册执行 **合并**——保留 **`minimumParameterCount`**（`incoming ?? prior`），**`parameterCount`** 取 **`max`**。这样 **先/后** 收录 `.h` 与 `.cpp` 任一顺序均可保留头文件上的 **最少实参个数**。

3. **消解**  
   - **`call-processor.ts`** 导出 **`symbolArityAcceptsArgCount`**：若存在 **`minimumParameterCount`**，则接受 **`min ≤ argCount ≤ parameterCount`**；否则仍为 **`argCount === parameterCount`**。  
   - 调试日志 **`formatCandidateBrief`** 中形参个数可显示为区间，如 **`4-5`**。

4. **图与 Worker**  
   - **`NodeProperties`**（`graph/types.ts`）、**`parse-worker` / `parsing-processor`** 在写入 **Method/Constructor** 时透传可选 **`minimumParameterCount`**（与 **`parameterCount`** 并列）。

#### 8.6.3 实现位置与测试

| 条目 | 位置 |
|------|------|
| 签名扩展与 C++ 最小实参个数 | `utils.ts`：`MethodSignature.minimumParameterCount`、`cppFormalParameterHasDefault`、`cppMinimumArgCountFromParameterNodes`、`extractMethodSignature` |
| 同 `nodeId` 合并 | `symbol-table.ts`：`mergeCallableFields`（在 `add` 内） |
| 消解 | `call-processor.ts`：`symbolArityAcceptsArgCount`、`filterCallableCandidates` |
| 流水线写入 | `parse-worker.ts`、`parsing-processor.ts`、`graph/types.ts` |
| 单元测试 | `test/unit/method-signature.test.ts`（类内 5 形参 + 末尾默认 → `min=4`；类外定义无 `min`）、`test/unit/symbol-table.test.ts`（合并顺序）、`test/unit/call-processor.test.ts`（4 实参 + receiver 收窄 → 唯一 `Connect`） |

#### 8.6.4 边界

- 若工程中 **仅有 `.cpp`**、且 **从未** 用带默认实参的 **声明** 参与索引同一 `nodeId`，则可能仍 **得不到** `minimumParameterCount`，行为与改造前一致。  
- 非 C++ 形式参数列表（如 TS `required_parameter`）不写入 `minimumParameterCount`，避免误用区间匹配。
