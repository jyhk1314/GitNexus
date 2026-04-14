# 本仓库与上游 GitNexus 的差异（合并后新版 Difflog）

> 生成说明：在 **合并 `upstream/main` 之后**，本文件描述 **GitNexus_jyhk** 相对官方仓库默认分支仍保留或新增的行为差异。原 `DIFF.md` 仍适用处已并入下文第一节；历史条目见 `MERGE_TRAJECTORY.md`。

---

## 一、clone-analyze / Local Git：带分支时的仓库目录名（保留）

与 `DIFF.md` 一致，核心规则不变：

| 项 | 说明 |
|----|------|
| **行为** | 指定 `branch` 时，克隆目录名为 `{repoBasename}@@{branchSlug}`；未指定分支时为 `{repoBasename}`。 |
| **分支 slug** | `branch.replace(/[^a-zA-Z0-9_\-]/g, '_')` |
| **分隔符** | `@@`（Windows 路径合法，避免与仓库名中单 `_` 混淆） |

**实现位置（合并后）**：

- **SSE 一体化接口**：`gitnexus/src/server/local-git-routes.ts` → `POST /api/repos/clone-analyze`；同文件 `POST /api/repos/zip-upload-analyze`（ZIP → `gitnexus_code`）。
- **作业式分析接口**：`gitnexus/src/server/api.ts` → `POST /api/analyze`：请求体可选 `branch`，克隆目标目录使用 `extractRepoName(url)` + `@@` + slug，与 `~/.gitnexus/repos/` 下 `getCloneDir` 一致。
- **Git 克隆**：`gitnexus/src/server/git-clone.ts` 中 `cloneOrPull(..., { branch })` 支持 `--branch` / `--single-branch`。
- **Web**：`gitnexus-web/src/components/RepoAnalyzer.tsx` 可选分支输入；`gitnexus-web/src/services/backend-client.ts` 的 `startAnalyze` 支持 `branch` 字段。

**专题文档**：仍见 [`docs/CLONE_ANALYZE_REPO_BRANCH_NAMING.md`](docs/CLONE_ANALYZE_REPO_BRANCH_NAMING.md)、部署说明 [`docs/DEPLOY.md`](docs/DEPLOY.md)（Local Git 相关章节）。

---

## 二、相对上游的附加行为与依赖

| 主题 | 要点 |
|------|------|
| **代码落盘目录** | Local Git / ZIP 流程仍使用 `gitnexus_code`（见 `local-git-routes.ts` 内 `getCodeDir()`）。 |
| **Ladybug 句柄释放** | `evictPoolsForDbPath`（`pool-adapter.ts`）、`closeLbugForPath`（`lbug-adapter.ts`），避免 analyze 后服务端仍占库。 |
| **仓库维护状态** | `isRepoUnderMaintenance` 在 `api.ts`、MCP `local-backend.ts` 中使用（与夜间维护文档一致）。 |
| **依赖** | `gitnexus/package.json` 增加 `adm-zip`（ZIP 上传）。 |

---

## 三、合并中让位给上游的部分（需后续从旧提交移植）

以下文件曾为分叉深度定制（如 C++ 调用解析、`minimumParameterCount`、process 过滤等），合并冲突修复时 **已用上游版本覆盖** 以保证可编译与类型检查通过。若需完整保留原分叉行为，请从合并前提交（例如 `bc1f3c5`）做 **逐文件 diff 与 cherry-pick**，并优先对齐到上游的 `model/`、`named-bindings/` 等新结构：

- `gitnexus/src/core/ingestion/call-processor.ts`
- `gitnexus/src/core/ingestion/workers/parse-worker.ts`
- `gitnexus/src/core/ingestion/process-processor.ts`
- 以及 `MERGE_TRAJECTORY.md` 中列出的其余已重置文件。

---

## 四、与上游差异体量（参考）

在合并提交暂存区上，相对 `upstream/main` 的统计约为：

```text
107 files changed, 6818 insertions(+), 118 deletions(-)
```

（以实际 `git diff upstream/main` 为准，会随后续提交变化。）

---

## 五、文档与轨迹

- **合并操作与冲突处理记录**：[`MERGE_TRAJECTORY.md`](MERGE_TRAJECTORY.md)
- **合并前差异归档**：[`DIFF.md`](DIFF.md)
