# C++ Method 节点合并与解析顺序日志

本文说明本仓库对 **C++ 声明/定义合并** 与 **解析文件顺序可观测性** 的改造，便于理解索引里 Method 的 `filePath` 行为及排查顺序问题。

---

## 一、背景：`.h` 与 `.cpp` 为何共用一个节点

- C++ 类成员在头文件中常为**声明**，在 `.cpp` 中为**带 `ClassName::` 的定义**。
- 解析层使用**类作用域的 `nodeId`**：`enclosingClassId` + 方法名 + **`#` + 参数类型列表指纹**（仅各形参的 **type** 子树文本，**不含**形参名与默认实参；再 SHA256 截断），使头文件声明与 `.cpp` 定义在**同一重载**上 id 一致，**不同重载**（参数类型不同）则为不同节点。
- 合并写入内存图时，历史上采用 **「同 id 先写入者优先」**：`addNode` 在节点已存在时直接忽略后续写入。

在常见 **glob 顺序下先扫 `.h` 再扫 `.cpp`** 时，Method 节点上的 `filePath`、`startLine` 等会长期停留在**头文件**，表或查询里看起来像「只有声明、没有实现位置」。

---

## 二、改造：`.cpp` 对同 id 的 Method/Constructor 高优先级覆盖

**文件**：`gitnexus/src/core/graph/graph.ts`

**规则**：当 **同一 `id` 已存在**，且**本次**写入的节点满足：

- `label` 为 **`Method` 或 `Constructor`**
- `properties.language` 为 **`cpp`**
- `properties.filePath` 以 **`.cpp`、`.cc`、`.cxx`** 结尾（大小写不敏感）

则 **用本次节点整颗替换** 图中已有节点（与已有节点来自 `.h` 或另一 `.cpp` 无关）。**后写入的 `.cpp` 覆盖先写入的**（同 id 时）。

**`nodeId` 指纹**：`gitnexus/src/core/ingestion/utils.ts` 的 `hashCppCallableOverloadSegment`：对每个形参只取 **`type` 字段**的文本（规范化空白），**忽略**形参名与默认实参。tree-sitter-cpp 中带默认实参的声明常用 **`optional_parameter_declaration`**，实现侧为 **`parameter_declaration`**，两者都参与指纹。在 **`parsing-processor` / `parse-worker`** 中仅对**类作用域**下的 `Method`/`Constructor` 追加 `#` 段。

**效果**：

| 顺序 | 结果 |
|------|------|
| 先 `.h` 后 `.cpp`（同 id） | 最终属性以 **后到的实现文件** 为准。 |
| 先 `.cpp` 后 `.h` | **仍为先写入的 `.cpp`**（`.h` 不满足覆盖条件，第二次写入被忽略）。 |
| 两个 `.cpp` 同 id | **后写入者覆盖**（重载一般 id 不同；同 id 多为同一符号多次 ingest）。 |

**非 C++** 或其它标签的重复 `id` 行为不变：**仍为先写入者优先**。

---

## 三、对关系的影响

| 关系 | 是否受影响 | 说明 |
|------|------------|------|
| **`HAS_METHOD`（Class → Method）** | **重载时多条** | 每个重载一个方法 id，同一类可有多条 `HAS_METHOD`。同 id 时行为与以前一致（幂等）。 |
| **`DEFINES`（File → Symbol）** | **不变** | 头/源可各有一条指向同一 Method id。 |
| **`CALLS` 等** | **仍以 nodeId 为端点** | 解析在能消歧时指向对应重载；符号表同文件同名多定义见 `lookupExactAllFull`。 |

---

## 四、解析顺序日志（`parse-order.log`）

**目的**：确认实际 **解析/合并顺序**（与「谁先 `addNode`」一致），用于对照 `.h`/`.cpp` 先后。

**文件**：`<仓库根>/.gitnexus/parse-order.log`

**实现**：`gitnexus/src/core/ingestion/pipeline.ts`（在按字节预算生成 `chunks` 之后写入）

**启用条件**（满足其一即可写日志；可用显式关闭）：

- `GITNEXUS_LOG_PARSE_ORDER=1`（或 `true` / `yes` / `on`）
- **`GITNEXUS_PROGRESS=1`**（与 CLI analyze 在 **clone-analyze** 子进程中的设置一致，**Local Git 路径默认会写**）

**关闭**（即使开了 `GITNEXUS_PROGRESS`）：

- `GITNEXUS_LOG_PARSE_ORDER=0`（或 `false` / `no` / `off`）

**格式要点**：

- 前几行为注释（版本、时间、`scanned_total`、`parseable`、`chunks`）。
- 中间为 **可解析文件** 的相对路径，**一行一个**，顺序即 pipeline 使用的顺序。
- 末尾注释块为各 chunk 在列表中的 **起止下标**，便于对照分块。

**控制台**：写入成功后会在 **stderr** 打一行绝对路径提示（不污染 `GITNEXUS_PROGRESS` 的 stdout JSON）。**Local Git** 下可在运行 `gitnexus serve` 的终端查看；日志文件在 **被 clone/分析的那份代码目录** 下的 `.gitnexus/`，而非 GitNexus 源码目录。

---

## 五、相关文档

- 部署与 Local Git：`docs/DEPLOY.md`
- 与本仓库相对上游的差异总表：`DIFF.md`（第五节 `gitnexus/src/core`）

---

## 六、单元测试

- `gitnexus/test/unit/graph.test.ts`：覆盖「`.h` → `.cpp` 覆盖」「`.cpp` → `.h` 不覆盖」「两个 `.cpp` 同 id 后者覆盖」及 `.cc`/`.cxx` 后缀。
- `gitnexus/test/integration/tree-sitter-languages.test.ts`：类内指针/引用返回且带函数体的成员捕获。
