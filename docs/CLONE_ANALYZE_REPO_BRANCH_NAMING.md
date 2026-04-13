# clone-analyze：带分支时的仓库目录名与分支 slug

本文说明 **Local Git（后端 clone-analyze）** 在**指定分支**时，服务端落盘目录名如何生成，以及 **Web 前端**解析「逻辑仓库名」时如何与后端保持一致。

---

## 目录名格式

当请求体中带 **`branch`**（非空）时，克隆目标目录为：

```text
{repoBasename}@@{branchSlug}
```

- **`repoBasename`**：克隆 URL 路径最后一段去掉 `.git` 后缀（与未指定分支时的目录名相同）。
- **`branchSlug`**：由原始分支名经 **slug 规则**得到（见下）。
- **分隔符 `@@`**：在仓库名与分支 slug 之间插入，避免与「仅用下划线拼接」混淆；且 **`@` 在 Windows 路径中合法**（若使用含 `|` 的分隔符，Windows 无法作为目录名）。

**未指定分支**时：目录名仍为 `{repoBasename}`，与上游行为一致。

---

## 分支 slug 规则

对原始分支字符串 `branch` 做：

```ts
branch.replace(/[^a-zA-Z0-9_\-]/g, '_')
```

含义：

- **保留**：英文字母、数字、下划线 `_`、连字符 `-`。
- **其余字符**（空格、`/`、`#`、`.`、`@`、中文等）：全部替换为 **`_`**。

这样得到的路径分量在常见文件系统上更安全，且避免与分隔符 `@@` 产生二义性（分支里的 `@` 也会被替成 `_`）。

---

## 代码位置（需保持一致）

| 位置 | 作用 |
|------|------|
| `gitnexus/src/server/api.ts` | `POST /api/repos/clone-analyze`：`dirSuffix` 为 `@@` + slug 化的分支名；`targetPath` 为 `codeDir` 下 `repoName + dirSuffix`。 |
| `gitnexus-web/src/App.tsx` | `resolveRepoName()`：同时存在 `baseName` 与 `branchTrimmed` 时，返回 `baseName` + `@@` + `branchSuffix`（`branchSuffix` 使用同一 `replace` 规则）。 |

前端在 **已存在目录 / 连接 Server 模式** 下用该逻辑名与后端注册表中的目录 basename 对齐；若两端规则不一致，会出现「连不上已克隆仓库」等问题。

---

## 与 ZIP 上传命名的区别

ZIP 上传分析使用 **`{zipBaseName}_zip`** 作为目录/仓库名后缀规则，与 **Git 分支**的 `@@` 规则独立，勿混用。

---

## 相关部署说明

用户向导读见根目录 [`DEPLOY.md`](../DEPLOY.md) **§ Local Git**；与本仓库相对上游的差异摘要见根目录 [`DIFF.md`](../DIFF.md)。
