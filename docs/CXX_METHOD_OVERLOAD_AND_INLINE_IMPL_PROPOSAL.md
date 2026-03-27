# C++ Method：重载去覆盖 + 类内联实现识别 — 改造方案（待确认）

> **状态**：**已实现**（见 `docs/CXX_METHOD_MERGE_AND_PARSE_ORDER.md`）。**修订**：重载 id 指纹为**仅各形参 `type` 子树**（无参名、无默认实参），保证 `.h` 声明与 `.cpp` 定义 id 一致；图合并为**后到的 `.cpp` 覆盖任意同 id**（含覆盖先前 `.cpp`），不再要求「仅覆盖头文件」。

---

## 1. 背景与目标

### 1.1 问题一：重载导致 `.cpp` 互相覆盖

同一类中多个重载成员函数**名字相同**，当前索引里往往对应**同一个 Method 节点 id**，后写入的 `.cpp` 会覆盖先写入的 `.cpp`，只剩最后一个实现。

**期望**：

- 多个 **`.cpp` / `.cc` / `.cxx`** 实现：即使函数名相同，也**不得互相覆盖**。
- **允许覆盖的仅来自头文件**（`.h` / `.hpp` / `.hh` / `.hxx` 等）：实现文件在「声明与定义合并」时仍可以更新节点上的 `filePath`、行号等（与现有产品语义一致）。

### 1.2 问题二：类体内带函数体的成员未被识别

在类声明内直接写出函数体、且**返回类型较复杂**时（如指针、多级指针、`const` 与指针组合），例如：

```cpp
ZmdbParseSqlStruct* GetSQLResult() { return &m_tParseSql; }
virtual const char* GetProvider() { return NULL; }
```

当前**未被稳定识别为 Method**（或根本未进入 `@definition.method` 捕获路径）。

**期望**：与命名空间/类外 `function_definition` 类似，对类内 `field_declaration_list` 下的实现做**同等深度的 declarator 展开**（指针/引用包裹），保证上述形态能生成 Method 节点并挂上 `HAS_METHOD`。

---

## 2. 现状（代码行为摘要）

### 2.1 Method 节点 id 的生成

文件：`gitnexus/src/core/ingestion/parsing-processor.ts`（Worker 路径下逻辑在 `gitnexus/src/core/ingestion/workers/parse-worker.ts` 中**重复一份**，改造时需两处一致。）

对 C++ 类成员，在存在 `enclosingClassId` 时：

- `nodeId = generateId(effectiveLabel, \`${nodeIdScope}:${nodeName}\`)`
- **`nodeName` 仅为标识符**，**未编码参数列表**，因此所有重载共享同一 id。

### 2.2 图合并：`.cpp` 覆盖同 id 节点

文件：`gitnexus/src/core/graph/graph.ts`

- 对 C++ 的 `Method` / `Constructor`，若新节点来自 `.cpp/.cc/.cxx`，则**无条件用新节点替换**图中已存在的同 id 节点。
- 与「先 `.h` 后 `.cpp` 时属性以实现为准」的设计一致，但**无法区分**「第二个 `.cpp` 重载」与「同一签名的实现覆盖声明」。

### 2.3 Tree-sitter 查询：类内「带 body」的成员

文件：`gitnexus/src/core/ingestion/tree-sitter-queries.ts` 中 `CPP_QUERIES` 已有：

- 类内**仅声明**（无 body）的 `field_declaration` + 若干指针返回声明；
- 类内 **function_definition** 仅匹配：`declarator` **直接**为 `function_declarator`，且 `declarator` 为 `field_identifier` / `identifier` 等。

当返回类型为 `T*` / `const T*` 等时，AST 常见形态为：

`function_definition` → `pointer_declarator`（可多层）→ `function_declarator` → `field_identifier`

该形态**未被**当前「类内 function_definition」规则覆盖，因此 `GetSQLResult` / `GetProvider` 类例子会漏捕。

**说明**：`gitnexus-web/src/core/ingestion/tree-sitter-queries.ts` 中的 `CPP_QUERIES` **更精简**，缺少大量 `gitnexus` 已具备的 C++ 规则；若 Web 端也需同等行为，应在实现阶段**对齐拷贝**或抽共享模块（本方案以 `gitnexus` 为主，Web 为可选同步项）。

---

## 3. 方案总览

| 子问题 | 思路 | 主要改动面 |
|--------|------|------------|
| 重载 id 冲突 | 在 **同一 `类作用域 + 方法名`** 下增加**稳定签名后缀**（由参数列表推导），使不同重载 id 不同 | `parsing-processor` / `parse-worker`、`utils`（新增或复用签名指纹）、可选 `symbol-table` |
| `.cpp` 互覆盖 | **仅当图中已存在节点来自「头文件路径」**时，才允许新的 `.cpp` Method/Constructor **整节点替换**；已存在节点若来自实现后缀，则**不替换**（同 id 时保留先写入者，或依赖签名后缀避免同 id） | `graph.ts` |
| 类内联实现漏捕 | 在 `CPP_QUERIES` 中，为 `field_declaration_list` 下的 `function_definition` **补全与文件级一致的** `pointer_declarator` / 双层指针 / `reference_declarator` 等模式 | `tree-sitter-queries.ts`（+ 集成测试） |

以下为推荐组合（**方案 A + B**）。

---

## 4. 方案 A：重载 — id 指纹 + 图合并收紧

### 4.1 签名指纹（推荐默认）

在生成 `nodeId` 时，对 C++ 且 `effectiveLabel` 为 `Method` 或 `Constructor`（及需与 `.cpp` 对齐的类内 `Function` 提升为 Method 的情况），在原有 `类:名` 后追加**确定性后缀**，例如：

- **优先**：对 `function_definition` / `declaration` / `field_declaration` 等定义节点，定位 `parameter_list`，对每个 `parameter_declaration` 取**类型子树文本**（或规范化后的 type 节点 text），用固定分隔符连接后做 **短哈希**（如 SHA256 前 8～12 位十六进制），得到 `overloadKey`。
- **退化**：若无法解析参数列表，则后缀为 `p<parameterCount>` 或 `unknown`，避免与「完全无参」冲突的规则需在实现时写清（见 4.3）。

**与现有属性关系**：`parameterCount` / `returnType` 仍写入 properties；`overloadKey` 可仅参与 id，不必持久化到 properties（可选写入便于调试）。

### 4.2 图合并规则（满足「只允许 .h 被覆盖」）

调整 `addNode` 中 C++ 实现覆盖逻辑：

- 当新节点满足「来自 `.cpp/.cc/.cxx` 的 Method/Constructor」且图中**已存在**同 id 节点时：
  - 若**已有节点**的 `filePath` 匹配**头文件后缀集合** → **允许替换**（保持「实现覆盖声明」）。
  - 若**已有节点**已来自 **`.cpp/.cc/.cxx`** → **禁止替换**（第二个实现不再踩掉第一个）。

**与 4.1 的配合**：

- 若签名后缀正确，**不同重载 id 不同**，则不会出现「两个 .cpp 争同一 id」；4.2 作为**安全网**，防止签名指纹碰撞或仅按参数个数区分的边界情况。

### 4.3 边界与权衡

| 场景 | 处理建议 |
|------|----------|
| 仅参数名不同、类型相同 | 指纹应基于**类型**而非参数名；与 AST 一致则 id 相同（符合 C++ 重载解析） |
| 模板实例化、宏展开导致类型文本不稳定 | 首版可用「参数个数 + 各参类型子树 text」；后续再考虑规范化 `type_identifier` 链 |
| `.h` 内联定义 + `.cpp` 外置定义 | 若两者签名一致且 id 一致：先 `.h`（内联）后 `.cpp` — 按 4.2，已有来自 `.h` 可被 `.cpp` 替换；若产品希望**保留内联所在行**为主，需另定优先级（当前未列入本次需求） |
| Constructor 重载 | 同样纳入签名后缀；跳过「类名即构造函数声明」的逻辑保持不变 |

---

## 5. 方案 B：类内联实现 — 扩展 `CPP_QUERIES`

在 `field_declaration_list` 下，为 `function_definition` 增加与文件作用域已存在的**对称**模式（将 `identifier` 换成类成员侧的 `field_identifier`，并保留 `operator_name` / `destructor_name` 等与现有类内规则一致）：

1. **一层 `pointer_declarator`** 包裹 `function_declarator`（覆盖 `T* method()` / `virtual const char* method()` 等常见情况）。
2. **两层嵌套 `pointer_declarator`**（`T** method()`）。
3. **`reference_declarator` 包裹 `function_declarator`**（`T& method()`）。

可选后续增强（若集成测试仍漏）：

- `const` 成员函数：若 grammar 将 `qualifiers` 挂在 `function_declarator` 上，需确认是否需单独 pattern（以实际 AST 为准）。
- `template_method_definition` 等 grammar 变体：按 tree-sitter-cpp 实际节点名增补。

**验证方式**：在 `gitnexus/test/integration/tree-sitter-languages.test.ts`（或新建专注 C++ 的用例文件）中加入最小复现代码片段，断言匹配到 `GetSQLResult` / `GetProvider` 的 `@name` 与 `@definition.method`。

---

## 6. 实现清单（确认后执行）

1. **`gitnexus/src/core/ingestion/utils.ts`**  
   - 新增 `buildCppMemberOverloadSegment(definitionNode): string`（或等价命名）：从 AST 提取参数类型指纹字符串 / 哈希。

2. **`gitnexus/src/core/ingestion/parsing-processor.ts`** 与 **`parse-worker.ts`**  
   - 在计算 `nodeId` 时，对 C++ Method/Constructor（及类内提升的 Method）拼接 overload 段；保持 `findEnclosingClassId` / `HAS_METHOD` 逻辑不变。

3. **`gitnexus/src/core/graph/graph.ts`**  
   - `addNode`：实现覆盖时读取已有节点；**仅当已有 `filePath` 为头文件后缀**时允许 `.cpp` 替换。

4. **`gitnexus/src/core/ingestion/tree-sitter-queries.ts`**  
   - 按方案 B 扩展类内 `function_definition` 查询。

5. **测试**  
   - `gitnexus/test/unit/graph.test.ts`：新增「两个 `.cpp` 同 id 不互覆盖」「`.cpp` 仍可覆盖 `.h`」。  
   - 集成测试：重载两个不同签名、类内 `T*` / `const T*` 成员带 body。  
   - 视需要更新 `graph.test.ts` 中示例 id（若测试写死了旧 id 格式）。

6. **文档**  
   - 更新 `docs/CXX_METHOD_MERGE_AND_PARSE_ORDER.md`：说明 **id 含签名后缀**、**.cpp 不覆盖 .cpp**。

7. **gitnexus-web（可选）**  
   - 若需与 CLI 一致，将 `CPP_QUERIES` 与相关解析逻辑对齐到 `gitnexus`（当前 Web 的 C++ 查询明显较简）。

---

## 7. 风险与后续

- **索引 id 变化**：Method id 格式变更会导致**与旧索引/外部引用**不兼容；属预期 breaking，需在变更说明中注明，并建议用户 `gitnexus analyze` 全量重建。
- **调用解析**：若调用边仅按「类 + 方法名」解析，重载增多后可能需后续增强为「按参数个数/类型」消歧（本次可不包含）。
- **GitNexus 流程**：落地前对修改符号执行 `gitnexus_impact`；提交前 `gitnexus_detect_changes`（按仓库规范）。

---

## 8. 待你确认的事项

1. **重载 id**：是否接受「参数类型子树文本 → 短哈希」作为默认指纹？是否需要把指纹明文写入节点 properties 便于排查？
2. **头文件后缀**：是否以 `.h/.hpp/.hh/.hxx`（大小写不敏感）为「可被 .cpp 覆盖」的集合即可，是否还要包含 `.inl` / `.inc`？
3. **gitnexus-web**：本次是否必须与本仓库 `gitnexus` **同步** C++ 查询与 id 规则，还是仅改 `gitnexus` 包？

---

**请确认以上方案（或批注修改点）后，再开始代码改造。**
