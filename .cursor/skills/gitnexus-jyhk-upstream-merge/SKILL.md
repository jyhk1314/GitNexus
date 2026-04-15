---
name: gitnexus-jyhk-upstream-merge
description: Use when merging official GitNexus upstream into the GitNexus_jyhk fork, scoping by git tag or commit, comparing two trees, or maintaining root DIFF.md for fork-only behavior; before large commits touching gitnexus/, sync summaries into docs or DIFF.md; upstream merge, cherry-pick, avoiding overwrite of local fork features documented in DIFF.md.
---

# GitNexus_jyhk：上游合入与差异分析

## 概述

本仓库相对官方 **GitNexus** 上游有两类改动，合入策略不同：

| 类型 | 含义 | 合入策略 |
|------|------|----------|
| **上游可对齐** | 与 fork 专属行为无关的 bugfix、通用重构、文档、测试 | 可直接合并 / cherry-pick / 按文件采纳上游 |
| **Fork 功能化改造** | 本仓库刻意改变的行为（部署、API、路径规则等） | 必须依据 **仓库根目录 `DIFF.md`** 做增量合并，避免覆盖本地已文档化的逻辑 |

**硬性要求：** 每次从上游拉取变更时，必须先指定 **git 引用**（tag、commit SHA，或 `commit1..commit2` 范围），只处理该范围内的变更，禁止「无边界整库覆盖」。

## 何时使用

- 需要把上游 GitNexus 新提交合入本仓库（`GitNexus_jyhk`）
- 需要比对「上游某版本」与「本地当前树」，整理 fork 专属差异清单
- 合入后要做验收，确认 `DIFF.md` 中的条目仍然成立

## 合入前输入（必须由用户或任务明确给出）

1. **上游仓库路径或 remote**（例如本机 `D:\github\GitNexus`，或 `upstream` remote）
2. **同步锚点**：至少一个 **tag 或 commit**（例：`v1.6.1` 或 `abc1234`，或 `old..new`）
3. **本地仓库路径**（`GitNexus_jyhk` 根目录）
4. **差异清单**：长期对照用 **仓库根 `DIFF.md`**（fork 行为差异；见下文「排除项」与格式）。大批次可辅以 **`docs/WORKING_TREE_CHANGES_*.md`** 交叉引用（见现有 `DIFF.md` 说明）

## 工作流

### 1. 抽取上游变更（必须带 git 引用）

```bash
# 单次提交
git -C <upstream-repo> show <commit> --stat
git -C <upstream-repo> show <commit> --name-only

# 标签或分支间范围
git -C <upstream-repo> log --oneline <from>..<to>
git -C <upstream-repo> diff <from>..<to> --stat
```

将「本次要合入的文件列表」与 **根 `DIFF.md` 已登记路径** 求交：交集上的文件按 **功能化 / fork 专属** 流程处理；其余文件可走常规上游合并。

### 2. 上游可对齐路径

- 上游修复、测试、与 `DIFF.md` 无关模块：优先 **cherry-pick** 或 **按文件合并**。
- 依赖版本、锁文件：若仅版本号漂移且无脚本/入口语义变化，按团队约定处理；若改变构建或原生绑定行为，在 PR 或 `DIFF.md` 中单独说明。

### 3. Fork 功能化路径（必须对照 `DIFF.md`）

- 打开 **根 `DIFF.md`**，按「路径 + 摘要 + 注意事项」判断本次上游变更是否触碰同一路径或同一行为。
- 合并方式优先：**cherry-pick 指定提交** 或 **按文件手工合并**；避免对大文件盲目 `checkout --theirs`。
- 若上游重构了某模块而本地 `DIFF.md` 有该路径：先读完两侧差异，再决定是跟进上游结构并在本地重挂 fork 行为，还是暂存上游该部分。

### 4. 合入后必做：比对与结论

针对「本次 git 引用范围内的上游变更」：

- [ ] **Fork 行为**：`DIFF.md` 涉及路径是否仍符合文档描述；冲突解决后是否需更新 `DIFF.md` 或 `docs/` 链接。
- [ ] **范围**：确认没有合入未声明引用之外的提交（除非用户明确要求扩大范围）。
- [ ] **跨包一致**：若改动涉及 `gitnexus` 与 `gitnexus-web` 等，检查命名/规则是否仍一致（例如 `DIFF.md` 中 clone-analyze 目录名与前端 `resolveRepoName()`）。

输出一段简短 **合入分析报告**（可放在 PR 描述或对话里）：引用范围、涉及文件、fork 路径处理方式、残留风险。

## `DIFF.md`：记录「本 fork 相对上游的行为差异」

### 不宜写入 `DIFF.md` 的噪声类差异

- **仅** 注释、Markdown 排版、空白、换行导致的文本不同：**不**作为「功能差异」逐条审计进表（除非影响生成代码或脚本语义）。
- **锁文件 / 生成物**：`package-lock.json` 等若仅有依赖版本漂移且无入口语义变化，默认**不**逐条展开；若本次提交确实改变 CLI、构建或原生模块行为，再点名对应 **非锁文件** 或单独一句说明。

### 生成方式（两引用或两棵树比对）

在 **相同基准** 或 **用户指定的两棵目录/分支** 上比对，例如：

```bash
git diff --no-color <upstream-ref> <local-ref> -- pathspec...
```

由 Agent 或人工 **过滤** 后维护根 `DIFF.md`：

- **收录**：行为变化、新 API、配置语义、与部署/路径相关的约定。
- **不收录**：纯格式化、仅依赖版本号无逻辑变化、可再生成且无行为含义的文件（除非内含逻辑）。

### 建议文件结构（与现有 `DIFF.md` 兼容）

在保持仓库已有「章节 + 表格 + 文档链接」风格的前提下，可按路径追加：

```markdown
## 路径索引
| 路径 | 摘要 | 上游合入时注意 |
|------|------|----------------|
| `gitnexus/src/server/api.ts` | … | … |

## 按主题 / 按文件
### `gitnexus/...`
- **本地行为**：…
- **与上游分叉原因**：…
- **合并提示**：…
```

新增 fork 行为时 **追加或更新** 对应小节；已删除的本地行为删除对应条目。

## 常见错误

| 问题 | 处理 |
|------|------|
| 未指定 tag/commit 就合并 | 先固定引用，再列 diff 与文件清单 |
| 合入后未对照 `DIFF.md` | 按「合入后必做」清单过一遍 |
| 对 `DIFF.md` 涉及路径整文件覆盖 | 除非用户确认放弃 fork 行为，否则手工合并 |
| 只改服务端未改前端（或反之） | 对照 `DIFF.md` 中跨包一致条目 |

## 快速命令参考

```bash
# 两引用之间变更文件列表
git diff --name-only <from>..<to>

# 单文件与上游对比（本地工作区）
git diff <upstream-remote>/<branch> -- path/to/file

# 查看某路径提交历史（定位引入上游改动的 commit）
git log --oneline -- path/to/file
```

---

## 可选：大改动前的「批次摘要」（非强制）

在准备提交 **大范围** `gitnexus/` 或全仓库改动前（人工或 Agent），可把本批次「功能向」摘要写入 **`docs/WORKING_TREE_CHANGES_YYYY-MM-DD.md`**（或等价命名），并在根 **`DIFF.md`** 的「历史 / 其他差异」一节增加链接。**根 `DIFF.md`** 仍是长期 **fork ↔ 上游** 对照的主清单；工作树说明文件只存 **当前批次**，合并主干后可归档或删改过时句段。

### 与根 `DIFF.md` 的分工

| 文档 | 何时更新 |
|------|----------|
| `DIFF.md`（根） | 新增/删除 **长期** fork 行为、与上游对比清单变化时 |
| `docs/WORKING_TREE_CHANGES_*.md` | 某次大改、多文件联动的 **批次说明** 与评审材料 |

---

**原则：** 可对齐上游的改动可直接合；**fork 专属行为**必须「有清单（`DIFF.md`）、有 git 范围、有验收」。**根 `DIFF.md`** 为长期差异清单；可选 **`docs/WORKING_TREE_CHANGES_*.md`** 为批次补充，与 git 引用范围一起使用。
