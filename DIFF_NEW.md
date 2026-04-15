# 本仓库与上游 GitNexus 的差异（合并后新版 Difflog）

> 在 **合并 `upstream/main` 之后**，本文件描述 **GitNexus_jyhk** 相对官方默认分支仍保留或新增的行为差异。原 [`DIFF.md`](DIFF.md) 中「带分支克隆目录名」等条目仍有效；合并操作记录见 [`MERGE_TRAJECTORY.md`](MERGE_TRAJECTORY.md)。

---

## 一、clone-analyze / Local Git：带分支时的仓库目录名（保留）

与 `DIFF.md` 一致：

| 项 | 说明 |
|----|------|
| **行为** | 指定 `branch` 时，克隆目录名为 `{repoBasename}@@{branchSlug}`；未指定分支时为 `{repoBasename}`。 |
| **分支 slug** | `branch.replace(/[^a-zA-Z0-9_\-]/g, '_')` |
| **分隔符** | `@@`（Windows 路径合法） |

**实现位置**：`gitnexus/src/server/local-git-routes.ts`、`gitnexus/src/server/api.ts`、`gitnexus/src/server/git-clone.ts`；Web 侧 `gitnexus-web/src/components/RepoAnalyzer.tsx`、`gitnexus-web/src/services/backend-client.ts`。

**专题文档**：[`docs/CLONE_ANALYZE_REPO_BRANCH_NAMING.md`](docs/CLONE_ANALYZE_REPO_BRANCH_NAMING.md)、[`docs/DEPLOY.md`](docs/DEPLOY.md)。

---

## 二、相对上游的附加行为与依赖

| 主题 | 要点 |
|------|------|
| **代码落盘目录** | Local Git / ZIP 流程使用 `gitnexus_code`（`local-git-routes.ts` → `getCodeDir()`）。 |
| **Ladybug 句柄释放** | `pool-adapter.ts` / `lbug-adapter.ts` 在 analyze 后释放连接。 |
| **仓库维护状态** | `isRepoUnderMaintenance`（`api.ts`、MCP `local-backend.ts`）。 |
| **依赖** | `adm-zip`（ZIP 上传）等。 |

---

## 三、合并后以「上游架构为底」回灌的本地化能力（2026-04 起）

以下在首次合并时曾以整文件采纳上游；随后在 **保持 `model/`、`LanguageProvider`、DAG pipeline** 的前提下，将分叉中的关键行为**重新接入**：

| 能力 | 说明 | 落地位置 |
|------|------|----------|
| **Process 过滤（`gitnexus.filter`）** | 仓库根 `gitnexus.filter` 中 `PROCESS` 的 `filePatterns` / `classPatterns`；C++ 进程追踪仅沿 `Function`/`Method` 等可调用边。 | `process-processor.ts`；`processes.ts` 在阶段内 `loadGitNexusFilter(ctx.repoPath)` 并传入 `processProcesses`。 |
| **C++ 导出宏预处理** | 解析前 strip `class DLL_API Foo` 等宏，便于 tree-sitter 识别 `class_specifier`。 | `parse-worker.ts` 对 C/C++ 调用 `preprocessCppExportMacros`（[`cpp-export-macro-preprocess.ts`](gitnexus/src/core/ingestion/cpp-export-macro-preprocess.ts)）。 |
| **C++ 调用图补边** | 对类作用域 Method/Constructor 的 `CALLS`，在已有边基础上补向所属 `Class`/`Struct` 的合成边（`cpp-method-implies-owner-class`）。 | `call-processor.ts` → `enrichCppCallsTargetsFromSiblingClassScope`；在 **`crossFile` 阶段之后**调用（覆盖跨文件二次 `processCalls` 产生的新边）。 |
| **C++ 重载与「最少参数」语义** | 旧分叉中的 `minimumParameterCount` 与上游 `requiredParameterCount`（由 `optional_parameter_declaration` 等推导）在语义上等价；无需在 `parse-worker` 中重复旧版 `extractMethodSignature`。 | 上游 `method-extractors/configs/c-cpp.ts` + `utils/method-props.ts`。 |

---

## 四、上游未包含、仅本地工作区存在的文件（非 Git 历史）

若你在 **`D:\github\GitNexus`** 等目录看到未跟踪的 `gitnexus/src/cli/cli/*.py`、`commands/*.py`，这些 **不属于** 官方 `upstream/main` 的提交内容，合并时不会自动出现；需单独决定是否纳入本仓库。

---

## 五、与上游差异体量（参考）

以本地仓库执行 `git diff upstream/main...HEAD --stat` 为准（随提交变化）。

---

## 六、文档与轨迹

- **合并操作与冲突处理**：[`MERGE_TRAJECTORY.md`](MERGE_TRAJECTORY.md)
- **合并前差异归档**：[`DIFF.md`](DIFF.md)
