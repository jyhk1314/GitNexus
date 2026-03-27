# C++ Method 节点合并与解析顺序日志

本文说明本仓库对 **C++ 声明/定义合并** 与 **解析文件顺序可观测性** 的改造，便于理解索引里 Method 的 `filePath` 行为及排查顺序问题。

---

## 一、背景：`.h` 与 `.cpp` 为何共用一个节点

- C++ 类成员在头文件中常为**声明**，在 `.cpp` 中为**带 `ClassName::` 的定义**。
- 解析层使用**类作用域的 `nodeId`**（`enclosingClassId` + 方法名），使同一成员在 `.h` 与 `.cpp` 中对应**同一个图节点**，便于 `HAS_METHOD`、调用图等与类对齐。
- 合并写入内存图时，历史上采用 **「同 id 先写入者优先」**：`addNode` 在节点已存在时直接忽略后续写入。

在常见 **glob 顺序下先扫 `.h` 再扫 `.cpp`** 时，Method 节点上的 `filePath`、`startLine` 等会长期停留在**头文件**，表或查询里看起来像「只有声明、没有实现位置」。

---

## 二、改造：实现文件覆盖声明侧属性

**文件**：`gitnexus/src/core/graph/graph.ts`

**规则**：当 **同一 `id` 已存在**，且本次写入的节点满足：

- `label` 为 **`Method` 或 `Constructor`**
- `properties.language` 为 **`cpp`**（`SupportedLanguages.CPlusPlus`）
- `properties.filePath` 以 **`.cpp`、`.cc`、`.cxx`** 结尾（大小写不敏感）

则 **用本次节点整颗替换** 图中已有节点（更新 `filePath`、`startLine`、`endLine`、`returnType` 等）。

**效果**：

| 顺序 | 结果 |
|------|------|
| 先 `.h` 后 `.cpp` | 最终属性以 **实现文件** 为准。 |
| 先 `.cpp` 后 `.h` | 仍为 **实现文件**（`.h` 不满足覆盖条件，第二次写入被忽略）。 |

**非 C++** 或其它标签的重复 `id` 行为不变：**仍为先写入者优先**。

---

## 三、对关系的影响

| 关系 | 是否受影响 | 说明 |
|------|------------|------|
| **`HAS_METHOD`（Class → Method）** | **基本不变** | `sourceId` / `targetId` 仍是类 id 与方法 id；方法 id 未改，边仍指向同一节点。`.h` 与 `.cpp` 各可能尝试创建 `HAS_METHOD`，关系 id 相同则第二条为幂等跳过，与改造前一致。 |
| **`DEFINES`（File → Symbol）** | **不变** | 关系含 **File** 端，头文件与实现文件可各有一条指向同一 Method id，改造不删除或合并这类边。 |
| **调用、其它边** | **不变** | 仍以方法 **nodeId** 为端点。 |

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

- `gitnexus/test/unit/graph.test.ts`：覆盖「`.h` → `.cpp` 覆盖」「`.cpp` → `.h` 不覆盖」及 `.cc`/`.cxx` 后缀。
