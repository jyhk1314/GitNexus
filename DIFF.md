# 本仓库与上游 GitNexus 的差异（Difflog）

本文档汇总 **GitNexus_jyhk** 相对官方上游（例如 npm `gitnexus` 发布版 / 官方仓库默认行为）的**行为与功能差异**。新增差异请在本文件追加条目，并在 `docs/` 下增加专题说明后在此交叉引用。

---

## 一、clone-analyze / Local Git：带分支时的仓库目录名

| 项 | 说明 |
|----|------|
| **行为** | 指定 `branch` 时，服务端克隆目录为 `{repoBasename}@@{branchSlug}`，例如 `MyApp@@feature-foo`。未指定分支时仍为 `{repoBasename}`。 |
| **分支 slug** | `branch.replace(/[^a-zA-Z0-9_\-]/g, '_')`：仅保留字母、数字、`_`、`-`，其余改为 `_`。 |
| **分隔符** | 使用 **`@@`** 连接仓库名与分支 slug（不用单 `_` 以免与仓库名混淆；不用含 `\|/` 等 **Windows 非法路径字符** 的写法）。 |
| **对齐** | `gitnexus/src/server/api.ts`（`POST /api/repos/clone-analyze`）与 `gitnexus-web/src/App.tsx` 中 `resolveRepoName()` 规则一致。 |

**详细说明**：[`docs/CLONE_ANALYZE_REPO_BRANCH_NAMING.md`](docs/CLONE_ANALYZE_REPO_BRANCH_NAMING.md)

**部署侧用户说明**：[`docs/DEPLOY.md`](docs/DEPLOY.md) § Local Git。

---

## 二、历史 / 其他差异条目

> 若仓库内另有 C++ CodeRelation、`minimumParameterCount`、parse-order 等改造，其条目可继续在本节或独立 `docs/WORKING_TREE_CHANGES_*.md` 中维护；合入时请把摘要链接回本节。

（可按需在此表格追加「路径 + 一句话」。）

| 文件 / 主题 | 要点 |
|-------------|------|
| （待补充） | （待补充） |
