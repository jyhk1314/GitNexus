# 合并轨迹：upstream/main → GitNexus_jyhk（main）

## 合并策略摘要

- **远程**：`upstream` → `https://github.com/abhigyanpatwari/GitNexus.git`，分支 `main`（合并时 HEAD 约为 `9ad1984` 及之后标签线，含 v1.6.x 演进）。
- **Git 操作**：`git merge upstream/main -X theirs`，在内容冲突时优先采纳上游实现；对 **modify/delete**（上游删除、本地修改过）类冲突，对 **已废弃的浏览器内 ingestion 等路径** 执行 `git rm` 以与上游架构一致。
- **合并后修复**：部分文件在自动合并后出现 **重复声明、残缺合并**，已用 `git checkout upstream/main -- <path>` 从上游恢复；并删除仅存在于旧分叉、且上游已由 `model/`、`named-bindings/` 等替代的遗留文件（见下）。

## 必须保留的本地化（与 `DIFF.md` 对齐）

| 主题 | 落地位置 | 说明 |
|------|----------|------|
| 带分支的 clone 目录名 `repo@@branchSlug` | `gitnexus/src/server/local-git-routes.ts`（`POST /api/repos/clone-analyze`）、`gitnexus/src/server/api.ts`（`POST /api/analyze` 克隆路径）、`gitnexus/src/server/git-clone.ts`（`cloneOrPull` 可选 `branch`） | 与 `DIFF.md` / `docs/CLONE_ANALYZE_REPO_BRANCH_NAMING.md` 一致 |
| 服务端本地代码目录 `gitnexus_code` | `local-git-routes.ts` 中 `getCodeDir()` | 仍落在 `HOME|USERPROFILE/gitnexus_code` |
| ZIP 上传分析 | `local-git-routes.ts`（`POST /api/repos/zip-upload-analyze`） | 依赖 `adm-zip` |
| Ladybug 连接释放（analyze 后） | `gitnexus/src/core/lbug/pool-adapter.ts`：`evictPoolsForDbPath`；`gitnexus/src/core/lbug/lbug-adapter.ts`：`closeLbugForPath` | 供 nightly / clone-analyze 释放锁与池 |
| 仓库维护期 API | `gitnexus/src/server/api.ts`、`gitnexus/src/mcp/local/local-backend.ts`：`isRepoUnderMaintenance` | 补全 import |
| Web：私有 Git URL + 可选分支 | `gitnexus-web/src/components/RepoAnalyzer.tsx`、`gitnexus-web/src/services/backend-client.ts` | 放宽 URL 校验；`startAnalyze` 传 `branch` |

## 有意恢复为上游版本的文件（避免损坏合并）

以下路径曾因三方合并产生重复符号/逻辑断裂，**已从 `upstream/main` 检出覆盖**（会暂时覆盖分叉里对同一文件的 C++ 等深度定制，需从旧提交按需 cherry-pick 回移植）：

- `gitnexus/src/core/ingestion/call-processor.ts`
- `gitnexus/src/core/ingestion/entry-point-scoring.ts`
- `gitnexus/src/core/ingestion/tree-sitter-queries.ts`
- `gitnexus/src/core/ingestion/framework-detection.ts`
- `gitnexus/src/core/ingestion/workers/parse-worker.ts`
- `gitnexus/src/core/ingestion/import-processor.ts`
- `gitnexus/src/core/ingestion/parsing-processor.ts`
- `gitnexus/src/core/ingestion/process-processor.ts`
- `gitnexus/src/core/ingestion/heritage-processor.ts`

## 删除的过时/冲突文件

- `gitnexus/src/core/ingestion/resolution-context.ts`（根目录；与 `model/resolution-context.ts` 重复）
- `gitnexus/src/core/ingestion/named-binding-extraction.ts`
- `gitnexus/test/unit/named-binding-extraction.test.ts`（依赖已删模块）

## 手工编辑修复（非上游整文件替换）

- `gitnexus/src/cli/analyze.ts`：移除重复的 `sigintHandler` 声明；保留 `setInterval(..., 1000)`。
- `gitnexus/src/core/graph/graph.ts`：去除重复的 `removeRelationship` 与 return 中重复键。
- `gitnexus/src/core/ingestion/type-extractors/index.ts`：补全 `Dart` / `Vue` / `Cobol` 的 `typeConfigs` 项；移除不存在的 `findChildByType` 再导出。

## 验证

- `cd gitnexus-shared && npm run build`
- `cd gitnexus && npx tsc --noEmit`（通过）

## 后续建议

1. 从合并前提交（如 `bc1f3c5`）对比 `call-processor.ts` / `parse-worker.ts` 等，将 **C++ 优化、minimumParameterCount、process 过滤** 等改动按功能拆分支移植到当前上游结构。
2. 运行 `gitnexus` 集成测试：`npm test`（视环境而定）。
3. 将本合并提交推送到 `origin` 前在私有部署环境做一次 **clone-analyze + 带分支 + 夜间刷新** 冒烟测试。

---

## 2026-04-14 本地化回灌（在 `upstream/main` 架构上补回分叉能力）

在 **不替换** 上游大文件（`call-processor` / `parse-worker` 仍以 SM-19 与 `LanguageProvider` 为主线）的前提下，已做如下接入：

| 改动 | 文件 |
|------|------|
| **Process 过滤**：`processProcesses` 增加 `processFilter`；`processes` 阶段 `loadGitNexusFilter(ctx.repoPath)` | `process-processor.ts`、`pipeline-phases/processes.ts` |
| **C++ 导出宏预处理** | `workers/parse-worker.ts` + `cpp-export-macro-preprocess.ts` |
| **C++ 补边**：`enrichCppCallsTargetsFromSiblingClassScope` 在 `crossFile` 阶段之后执行 | `call-processor.ts`、`pipeline-phases/cross-file.ts` |

说明：`minimumParameterCount` 与上游 `requiredParameterCount`（C++ 可选形参）语义对齐，见 `method-extractors/configs/c-cpp.ts` 与 `utils/method-props.ts`。
