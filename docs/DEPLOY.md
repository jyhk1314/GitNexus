# GitNexus 部署与使用

本文档说明如何启动服务以及 Web UI 的四种使用方式。

---

## 打包方式
cd d:\github\GitNexus\gitnexus; npm run build 2>&1

---

## 启动方式

| 场景 | 命令 |
|------|------|
| **后台启动**（HTTP 服务，供 Web UI 连接） | `npx gitnexus serve --port 6660 --host 0.0.0.0` |
| **后台启动（含向量搜索）** | `npx gitnexus serve --port 6660 --host 0.0.0.0 --embeddings` |
| **前台启动**（开发模式，在 `gitnexus` 目录下） | `npm run dev -- --host 0.0.0.0 --port 5175` |

**跨机访问**：使用 `--host 0.0.0.0` 时，服务会监听所有网卡，但本机防火墙可能拦截入站连接。若其他机器无法访问，请在**运行 serve 的那台机器**上放行对应端口的入站 TCP（例如 Windows：高级安全 Windows 防火墙 → 入站规则 → 新建规则 → 端口 → TCP 6660）。

---

## 使用方式

Web UI 支持四种接入代码的方式，对应不同的数据存放位置。

### 1. 上传 ZIP — 压缩本地代码上传

- 将本地代码打成 ZIP，在 Web UI 中上传。
- **代码保存位置**：本地浏览器（不经过服务器）。
- **后端处理（可选）**：在 ZIP 选项上填写后端代理地址（如 `http://10.128.128.88:6660`），则会将 ZIP 上传到后端解压、分析、向量化，代码落在服务端 `ginexus_code/{压缩包名}`。已上传过的压缩包（按名称判断）会自动转为 Server 模式访问。

### 2. 访问公网 GitHub

- 在 Web UI 中填写公网 GitHub 仓库地址。
- **代码保存位置**：本地浏览器。

### 3. Local Git — 后端 clone-analyze（代码落在服务端）

- **填写服务地址**：必填，例如 `http://10.128.128.88:6660`（即运行 `gitnexus serve` 的机器地址与端口）。前端会调用该地址的 **clone-analyze** 接口，由服务端执行 clone + 分析。
- **填写研发云仓库 Git 地址**：你的内网/研发云 Git 仓库 URL（HTTPS）。
- **填写令牌**：在研发云仓库 → 应用菜单中申请令牌（私有仓库必填）。
- **代码保存位置**：**服务端** `{HOME 或 cwd}/ginexus_code/{仓库名}`，不再在浏览器内拉取。
- **GBK→UTF-8**：clone 完成后、建索引前，服务端会自动调用 `scripts/convert_to_utf8.py` 将仓库内文本转为 UTF-8。需在 **运行 serve 的机器** 上安装 **Python**，并确保 gitnexus 包内存在 `scripts/convert_to_utf8.py`。若未转成 UTF-8，请查看 serve 控制台 “UTF-8 conversion skipped” / “UTF-8 conversion failed” 日志。

### 4. Server — 直连已有后端

- **填写服务后端地址**：例如 `http://10.128.128.88:6660`（本机已运行的 `gitnexus serve`）。
- **填写仓库名称**：该后端上已通过 `gitnexus analyze` 或 clone-analyze 建好索引的仓库名。
- **代码保存位置**：后端服务（索引与数据均在 serve 所在机器）。

---

## 使用经验

1. **支持 Cypher Query 进行图检索**：可在 Web UI 中执行 Cypher 查询，对知识图谱做图检索。
2. **支持配置大模型进行检索**：使用大模型时，可配置：
   - **公司代理地址**：`https://lab.iwhalecloud.com/gpt-proxy/v1`
   - **模型选择**：`claude-4.5-sonnet`
   - **API Key**：通过钉钉聊天机器人「大模型机器人」申请
   - **大模型迭代最大周期**：当前默认 **100 次**（可通过设置中的 `recursionLimit` 配置项调整），限制单轮对话中「推理 → 调用工具 → 再推理」的循环上限，避免无限递归。该配置项存储在本地设置中，可在 LLM 设置界面进行修改。

3. **内容截断规则**（何时会出现 `[truncated]`）  
   建索引 / 写入图库时，为控制存储与展示体积会对以下内容做截断，超出部分替换为 `... [truncated]`：
   - **整文件内容**（File 节点）：超过 **200,000 字符**（约 5000 行）时，只保留前 200,000 字符。
   - **单符号代码片段**（函数/类等节点详情）：超过 **60,000 字符**（约 1500 行）时，只保留前 60,000 字符。  
   Wiki 生成时，单模块源码总 token 超过 **30,000**（默认）会对模块源码做截断，并注明 `(source truncated for context window limits)`。  
   **Web UI（LLM 工具读文件）**：`read_file` 等工具单文件内容上限与 File 节点一致，为 **200,000** 字符。  
   **Web UI（工具调用卡片）**：单条工具返回文本在卡片中仅预览前 **6,000** 字符（完整内容仍保留在对话上下文中）；详见 `docs/GIT_WORKTREE_CHANGES_2026-03-24.md`。

4. **嵌入模型（语义/向量搜索）**  
   - **模型**：**Snowflake/snowflake-arctic-embed-xs**（约 22M 参数，384 维，~90MB）。  
   - **用途**：Web 前端、Node 端（analyze/serve）、MCP 查询嵌入均使用该模型；用于语义检索与 BM25 混合搜索。  
   - **下载源**：  
     - **Web 前端（ZIP/公网 GitHub 等）**：浏览器会从**当前页面同源**的 `/hf-mirror/` 请求模型文件，以避免直连 hf-mirror.com 时的 CORS 限制。开发时 Vite 已配置将该路径代理到 **https://hf-mirror.com**；**生产环境**若自建 Web 服务（如 nginx）托管前端，需同样将 `/hf-mirror` 反向代理到 `https://hf-mirror.com`，否则会报 CORS 且无法加载模型。  
     - **Node 端 / MCP**：直连 **https://hf-mirror.com**，无需代理。  
   - **配置位置**：Web/Node 默认在 `core/embeddings/types.ts` 的 `DEFAULT_EMBEDDING_CONFIG.modelId`；MCP 在 `mcp/core/embedder.ts` 的 `MODEL_ID`。

---

## 变更记录（工作区）

- 近期未提交改动的方案与文件级说明见：**[GIT_WORKTREE_CHANGES_2026-03-24.md](./GIT_WORKTREE_CHANGES_2026-03-24.md)**（检索、FTS、嵌入就绪、Web Worker 与 LLM 工具等）。

---

## 小结

| 方式 | 主要配置 | 代码/索引所在 |
|------|----------|----------------|
| 上传 ZIP | 上传 ZIP 文件 | 浏览器本地 |
| 上传 ZIP（后端） | 代理地址 + ZIP 文件 | 服务端 ginexus_code |
| 公网 GitHub | 填写 GitHub 地址 | 浏览器本地 |
| Local Git | 服务地址 + Git 地址 + 令牌 | 代理服务（serve 机器） |
| Server | 后端地址 + 仓库名称 | 后端服务（serve 机器） |
