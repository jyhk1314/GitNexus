# 本仓库与上游 GitNexus 的差异（Difflog）

本文档汇总 **GitNexus_jyhk** 相对官方上游 **GitNexus**（[abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus)）的**行为与功能差异**。新增差异请在本文件追加条目，并在 `docs/` 下增加专题说明后在此交叉引用。

---

## 零、上游对齐点（下次对比从这里算起）

两个目录若是**独立克隆**、未互为 remote，也可用手动路径对比；下列 **Git 提交** 以在 **本仓库** 中执行 `git fetch upstream` 后能解析的引用为准（`upstream` 指向官方仓库）。

### 当前记录（维护时请更新本小节日期与哈希）

| 字段 | 值 |
|------|-----|
| **记录日期** | 2026-04-15 |
| **本仓库 `HEAD`** | `bea1e6b4589066f2517f1620b3c9ca7ad049721b` |
| **与 `upstream/main` 的最近公共祖先（对齐点）** | `9ad1984b17e4c53f7e3085226f0e4ce17ad9354b` |
| **对齐点在一句话** | `fix: resolve C/C++ cross-file calls through transitive #include chains (#816)` |
| **对齐点 `git describe`（在官方仓库上）** | `v1.6.1-6-g9ad1984`（基于 `v1.6.1` 的 describe，**非**单独打在 `9ad1984` 上的 release tag） |
| **当时本地官方克隆 `D:\github\GitNexus` 的 `main` tip** | `c100577e5ed3802c89b3c04fb9b6cbe439ea1f84`（`fix(embeddings): … (#823)`） |
| **该 tip 的 RC tag（官方仓库）** | `rc/c100577e5ed3802c89b3c04fb9b6cbe439ea1f84` |

含义：**对齐点 `9ad1984`** 是「本 fork 与官方 `main` 历史仍重合」的最后提交；官方在此之后还有新提交（例如 `c100577`），本仓库尚未以 `main` 快进到同一 tip。

### 下次如何对比（在 `GitNexus_jyhk` 根目录）

```powershell
git fetch upstream
# 重新计算对齐点（若合入过上游，会变）
git merge-base HEAD upstream/main
# 官方从「上次对齐点」到现在多了什么
git log --oneline 9ad1984b17e4c53f7e3085226f0e4ce17ad9354b..upstream/main
git diff --stat 9ad1984b17e4c53f7e3085226f0e4ce17ad9354b..upstream/main
# 本 fork 从对齐点起多了什么（功能清单用）
git log --oneline 9ad1984b17e4c53f7e3085226f0e4ce17ad9354b..HEAD
```

独立克隆、仅有两份工作区时，可在 **官方仓库** 目录执行 `git fetch origin` 后，用同一 **对齐点 SHA** 与 **官方 `origin/main` 的 SHA** 做 `git diff <对齐点>..<官方main>`，结果应与上表「官方多出来的提交」一致。

### 不宜写进本表的差异

- 仅 **依赖版本 / lockfile** 漂移且无行为语义变化：默认不逐条记入，除非改变 CLI、原生模块或构建脚本语义。
- 仅 **注释、排版、无行为改动的 Markdown**：不记入。

---

## 一、clone-analyze / Local Git：带分支时的仓库目录名

| 项 | 说明 |
|------|------|
| **行为** | 指定 `branch` 时，服务端克隆目录为 `{repoBasename}@@{branchSlug}`，例如 `MyApp@@feature-foo`。未指定分支时仍为 `{repoBasename}`。 |
| **分支 slug** | `branch.replace(/[^a-zA-Z0-9_\-]/g, '_')`：仅保留字母、数字、`_`、`-`，其余改为 `_`。 |
| **分隔符** | 使用 **`@@`** 连接仓库名与分支 slug（不用单 `_` 以免与仓库名混淆；不用含 `\|/` 等 **Windows 非法路径字符** 的写法）。 |
| **对齐** | `gitnexus/src/server/api.ts`（`POST /api/repos/clone-analyze`）与 `gitnexus-web/src/App.tsx` 中 `resolveRepoName()` 规则一致。 |

**详细说明**：[`docs/CLONE_ANALYZE_REPO_BRANCH_NAMING.md`](docs/CLONE_ANALYZE_REPO_BRANCH_NAMING.md)

**部署侧用户说明**：[`docs/DEPLOY.md`](docs/DEPLOY.md) § Local Git。

---

## 二、路径索引（相对上游对齐点的 fork 功能增量）

下列为 **本仓库相对对齐点 `9ad1984`** 已出现、且与上游 `main`（截至记录日）对比时仍体现为差异的主要路径或主题；合入上游新提交时请优先对照本节与 `docs/` 专题。

| 路径 / 主题 | 要点 |
|-------------|------|
| `gitnexus/src/core/ingestion/call-processor.ts` | C++：`enrichCppCallsTargetsFromSiblingClassScope` 等，为 Method/Constructor 调用补 `CALLS →` 所属 `Class`/`Struct`。详见 [`docs/CXX_CALLS_OWNER_CLASS_ENRICHMENT.md`](docs/CXX_CALLS_OWNER_CLASS_ENRICHMENT.md)。 |
| `gitnexus/src/core/ingestion/cpp-export-macro-preprocess.ts` | C/C++ 解析前对导出宏等预处理；由 `parse-worker` 接入。 |
| `gitnexus/src/core/ingestion/gitnexus-filter.ts` + `process-processor.ts` | 进程级过滤配置（与 pipeline `processes` 衔接）。 |
| `gitnexus/src/core/ingestion/pipeline-phases/cross-file.ts` | 与跨文件解析相关的少量 fork 调整（对照上游合并时需注意）。 |
| `gitnexus/src/server/local-git-routes.ts` | Local Git HTTP API（大块新增）。 |
| `gitnexus/src/server/api.ts`、`git-clone.ts`、`mcp-http.ts` | 与 clone-analyze、分支目录名、MCP 等一致化修改。 |
| `gitnexus/src/server/nightly-refresh.ts`、`git-nightly-sync.ts`、`maintenance/repo-maintenance.ts` | 夜间刷新与仓库维护状态。 |
| `gitnexus/src/server/utf8-conversion.ts` | 路径/编码相关服务端逻辑。 |
| `gitnexus/src/mcp/local/local-backend.ts` | 本地 MCP 列表与维护位等。 |
| `gitnexus-web/src/App.tsx`、`RepoAnalyzer.tsx`、`clone-analyze-progress.ts` 等 | 前端与 clone-analyze、分支名解析、`QueryFAB` 等交互一致。 |
| `gitnexus-web/src/core/ingestion/gitnexus-filter.ts`、`call-routing.ts` | 与 CLI/服务端过滤策略对齐的前端侧能力。 |
| `gitnexus/test/unit/method-signature.test.ts`、`process-processor.test.ts`、`call-processor.test.ts` 等 | fork 行为与回归测试。 |
| `gitnexus/test/fixtures/lang-resolution/cpp-*` 等 | C++ 场景 fixture。 |
| `docs/CXX_*.md`、`docs/NIGHTLY_REFRESH_AND_MAINTENANCE.md` 等 | C++ 与部署专题文档。 |

### 与上游仓库布局的差异（非功能时可略）

- 本 fork 可能 **不包含** 上游部分 CI（例如 `.github/workflows/release-candidate.yml`）或个别根目录文档；合入时以官方为准或按团队策略恢复，**不必**记入本表除非影响发布语义。

---

## 三、历史 / 其他差异条目

> 若还有 CodeRelation、`minimumParameterCount`、parse-order 等改造，可在本节或 [`docs/WORKING_TREE_CHANGES_*.md`](docs/) 展开，并在此表格留一行索引。

| 文件 / 主题 | 要点 |
|-------------|------|
| C++ 图与解析 | 见 `docs/CXX_CODERELATION_OPTIMIZATION_PLAN.md`、`docs/CXX_METHOD_MERGE_AND_PARSE_ORDER.md` 等。 |
| 批次说明 | 例如 [`docs/WORKING_TREE_CHANGES_2026-03-31.md`](docs/WORKING_TREE_CHANGES_2026-03-31.md)。 |

---

**维护约定：** 每次自 **官方 `main` 合入** 或 **确认仍与某上游提交对齐** 后，更新 **「零、上游对齐点」** 中的 SHA、`git describe`、以及「当时官方 `main` tip」三列，便于下一次 `git log <旧对齐点>..upstream/main` 只处理新增上游变更。
