# Serve 定时刷新与维护模式

本文说明 `gitnexus serve` 的**夜间定时**重新拉取代码、全量重分析，以及在重分析期间**禁止访问**对应仓库索引的实现与用法。与上游差异的条目汇总见仓库根目录 **`DIFF.md`**。

## 功能概览

| 能力 | 说明 |
|------|------|
| 定时任务 | 进程内定时器每 30 秒检查一次**本机本地时间**；到达设定时刻（默认每天 **02:00**）触发一次批处理。 |
| 批处理范围 | `~/.gitnexus/registry.json` 中**已校验存在索引**（`meta.json` 存在）的仓库，**串行**逐个处理。 |
| Git 同步 | 与「clone-analyze 后再分析」对齐：**清理工作区 → fetch → 检出分支 → 与 `origin/<branch>` 对齐 → 再 clean**；详见 `gitnexus/src/server/git-nightly-sync.ts`。 |
| 编码 | 调用 `convert_to_utf8.py`（与 clone-analyze / ZIP 上传相同），将 GBK 等遗留编码转为 UTF-8。 |
| 重分析 | 子进程执行 `gitnexus analyze --force <repoPath>`；若 serve 带 `--embeddings` 则附加 `--embeddings`。 |
| 维护模式 | 处理某一仓库前将其标记为维护中：HTTP 返回 **503**，MCP 在 `resolveRepo` 时抛错；处理结束或失败后清除标记。 |

## CLI 用法

```bash
gitnexus serve --host 0.0.0.0 --embeddings --nightly-refresh --nightly-at 02:00
```

| 选项 | 含义 |
|------|------|
| `--nightly-refresh` | 启用每日定时刷新（本地服务器时区下的墙钟时间）。 |
| `--nightly-at <hh:mm>` | 24 小时制，默认 `02:00`。 |
| `--embeddings` | 定时任务中的 `analyze` 也生成向量（与 clone-analyze 行为一致）。 |

## 指定夜间拉取分支

在 **`~/.gitnexus/registry.json`** 中对应条目增加可选字段 **`branch`**（例如 `"branch": "main"`）。未配置时，使用当前检出分支名（`git rev-parse --abbrev-ref HEAD`）；若处于 detached HEAD 且未配置 `branch`，同步会失败并打日志。

重新执行 `gitnexus analyze` 写回注册表时，会**保留**已有 `branch` 字段（见 `registerRepo`）。

## 单仓库处理顺序（概要）

1. `setRepoMaintenance(name, true)`
2. `closeLbugForPath`（HTTP 侧全局 Ladybug 连接）
3. `evictPoolsForDbPath`（MCP 侧按路径驱逐只读连接池，降低与 analyze 写库冲突）
4. `syncGitRepoLikeCloneAnalyze`（git 命令序列）
5. `convertWorkspaceToUtf8`
6. `analyze --force`
7. `setRepoMaintenance(name, false)` + `LocalBackend.reloadFromRegistry()`

## HTTP 与 MCP 行为

- **GET `/api/repos`**：每项包含 `maintenance?: boolean`、`branch?: string`（若注册表中有）。
- **受维护影响的接口**：对指定仓库返回 **503** 及 `maintenance: true`（如 `/api/graph`、`/api/query`、`/api/search`、`/api/file` 等）；MCP 工具在 `resolveRepo` 阶段报错，错误信息含 `re-indexing` 时映射为 503。

## 相关源码路径

| 路径 | 职责 |
|------|------|
| `gitnexus/src/maintenance/repo-maintenance.ts` | 维护中仓库名（内存 Set） |
| `gitnexus/src/server/nightly-refresh.ts` | 调度与批处理入口 |
| `gitnexus/src/server/git-nightly-sync.ts` | Git 同步命令序列 |
| `gitnexus/src/server/utf8-conversion.ts` | 统一调用 `convert_to_utf8.py` |
| `gitnexus/src/server/api.ts` | 503、`nightlyRefresh` 选项、复用 `convertWorkspaceToUtf8` |
| `gitnexus/src/cli/serve.ts`、`gitnexus/src/cli/index.ts` | CLI 参数 |
| `gitnexus/src/mcp/core/lbug-adapter.ts` | `evictPoolsForDbPath` |
| `gitnexus/src/mcp/local/local-backend.ts` | `reloadFromRegistry`、维护检查、`listRepos` |
| `gitnexus/src/storage/repo-manager.ts` | `RegistryEntry.branch`、`registerRepo` 保留分支 |

## 注意事项

- **本地提交会被覆盖**：`syncGitRepoLikeCloneAnalyze` 使用 `reset --hard origin/<branch>`，与远端不一致的本地提交会丢失；需要保留本地提交时应调整同步策略。
- **`git fetch` / `git pull` 依赖**：运行环境需能访问 `origin`，且已配置远程与凭据（SSH/凭证助手等）。
- **时区**：定时使用 `Date` 的本地时区；需「北京时间」等请保证系统时区或进程环境正确。
