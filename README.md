# GitNexus (本地化增强版)

> ⚠️ **重要说明：** 这是从 [abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus) v1.4.0 fork 出来的**本地化增强版本**，针对中文环境和特定使用场景进行了优化改造。详细改造内容请查看 [DIFF.MD](./DIFF.MD)。

## ✨ 本版本主要增强特性

### 🇨🇳 中文本地化支持
- **UTF-8 编码自动转换**：自动将下载的仓库文件转换为 UTF-8 编码，完美支持中文代码
- **Hugging Face 镜像站**：使用国内镜像站（hf-mirror.com），避免直连慢或不可用的问题
- **中文界面优化**：进度提示、错误信息等全面中文化

### 🚀 新增核心功能
- **一键克隆并分析**：`POST /api/repos/clone-analyze` - 支持私有仓库、内网仓库、自托管 Git 服务
- **ZIP 上传分析**：`POST /api/repos/zip-upload-analyze` - 支持最大 500MB，自动处理目录结构
- **Git 代理服务**：`GET/POST /api/proxy` - 为 Web 端 Local Git 提供代理转发，解决跨域和鉴权问题
- **流式响应优化**：所有分析接口支持流式进度反馈，实时显示处理状态

### 🔧 C++ 场景增强
- **新增节点类型**：支持 `Struct`（结构体）和 `Macro`（宏）节点类型
- **文件关联优化**：自动关联 `.h` 和 `.c` 文件
- **表名转义处理**：确保特殊表名（Struct、Enum、Macro 等）在 Cypher 查询中正确执行

### ⚡ 性能与体验优化
- **文件大小限制提升**：从 512KB 提升到 2MB，避免跳过较大文件
- **Tree-sitter 缓冲区优化**：从 512KB 提升到 2MB
- **数据库连接管理**：分析完成后自动释放文件锁，避免后台服务持有数据库连接
- **默认端口调整**：从 4747 改为 6660（避免端口冲突）

### 🎨 Web UI 增强
- **Local Git 支持**：新增 Local Git Tab，支持克隆任意 Git 仓库（私有/内网/自托管）
- **Canvas 聚焦支持**：支持检索代码进行画布聚焦，避免对海量代码检索时找不到检索点
- **查询保存功能**：支持保存常用 Cypher 查询到 localStorage
- **内置查询扩展**：从 5 个扩展到 13 个（中文标签）
- **递归限制配置**：支持配置 LLM 递归次数限制
- **结果分页功能**：查询结果支持分页显示（50条/页）

---

## 📋 与原版对比

| 特性 | 原版 | 本版本 |
|------|------|--------|
| **中文支持** | ❌ | ✅ UTF-8 自动转换 |
| **HF 镜像** | ❌ 直连 | ✅ 国内镜像站 |
| **ZIP 上传** | ❌ | ✅ 最大 500MB |
| **私域代理** | ❌ | ✅ 支持本地/内网GIT |
| **C++ 支持** | ⚠️ 基础 | ✅ Struct/Macro |
| **文件大小限制** | 512KB | 2MB |
| **默认端口** | 4747 | 6660 |
| **流式进度** | ⚠️ 部分 | ✅ 完整支持 |

---

## 🎯 适合使用本版本的情况

✅ **推荐使用本版本，如果你：**
- 需要处理包含中文注释或文件名的代码库
- 在中国大陆使用，需要访问 Hugging Face 模型
- 需要构建私域的GIT项目
- 需要分析 C++ 项目（特别是结构体和宏定义）
- 需要上传 ZIP 文件进行分析（最大 500MB）
- 需要克隆私有仓库或内网 Git 服务
- 需要更大的文件处理能力（>512KB）

❌ **建议使用原版，如果你：**
- 不需要中国本地化改造支持
- 不需要内网的GIT分析支撑
- 需要跟随原版的最新更新

---

## 🚀 快速开始

### 安装

```bash
# 克隆本仓库
git clone https://github.com/jyhk1314/GitNexus.git
cd gitnexus

# 安装依赖
npm install

# 启动
npx gitnexus serve --port 6660 --host 0.0.0.0 --embeddings
```

### Web UI 使用

```bash
cd gitnexus-web
npm install
npm run dev -- --host 0.0.0.0 --port 5175
```

访问 `http://localhost:5175`（或你配置的端口）

**新增功能：**
- **Local Git Tab**：输入 Git URL、Token、分支，一键克隆并分析
- **ZIP Upload Tab**：拖拽 ZIP 文件（最大 500MB），自动分析
- **Server Tab**：连接到本地服务器（默认 `http://localhost:6660`）

---

## 📖 核心功能

GitNexus 将代码库索引为知识图谱，追踪每个依赖关系、调用链、集群和执行流程，通过智能工具让 AI 代理永不遗漏代码。

### 主要特性

- **知识图谱构建**：完整的代码结构、依赖关系、调用链
- **智能搜索**：混合搜索（BM25 + 语义 + RRF）
- **影响分析**：变更影响范围分析
- **执行流程追踪**：从入口点追踪完整调用链
- **社区检测**：自动识别功能相关的代码集群
- **多语言支持**：TypeScript, JavaScript, Python, Java, Kotlin, C, C++, C#, Go, Rust, PHP, Swift

### MCP 工具

通过 MCP 协议暴露 7 个工具：

| 工具 | 功能 |
|------|------|
| `list_repos` | 列出所有已索引的仓库 |
| `query` | 混合搜索（BM25 + 语义 + RRF） |
| `context` | 360度符号视图 |
| `impact` | 影响范围分析 |
| `detect_changes` | Git diff 影响分析 |
| `rename` | 多文件协调重命名 |
| `cypher` | 原始 Cypher 图查询 |

---

## 🔧 配置说明

### 技能生成配置

支持从 `.gitnexus/skill-config.json` 读取配置：

```json
{
  "communityDirFilter": ["app", "helper"],
  "otherSettings": "..."
}
```

### 环境变量

```bash
# 启用 embeddings（如果使用）
GITNEXUS_ENABLE_EMBEDDINGS=true

# 进度输出格式（JSON）
GITNEXUS_PROGRESS=1
```

---

## 📝 详细改造内容

完整的改造内容请查看 [DIFF.MD](./DIFF.MD)，包括：

- 后台服务增强（API 端点、数据库管理、错误处理）
- CLI 命令增强（端口、embeddings、进度输出）
- Web UI 增强（Local Git、ZIP 上传、查询保存）
- C++ 场景支持（Struct、Macro 节点）
- 中文本地化（UTF-8 转换、HF 镜像）

---

## 🤝 贡献

本版本基于 [abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus) v1.4.0 进行改造。

- **原版仓库**：https://github.com/abhigyanpatwari/GitNexus
- **本版本仓库**：https://github.com/jyhk1314/GitNexus

---

## 📄 许可证

与原版保持一致：[PolyForm Noncommercial License](https://polyformproject.org/licenses/noncommercial/1.0.0/)

---

## 🙏 致谢

- [abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus) - 原版项目
- [Tree-sitter](https://tree-sitter.github.io/) - AST 解析
- [KuzuDB](https://kuzudb.com/) - 嵌入式图数据库
- [LadybugDB](https://ladybugdb.com/) — 嵌入式图数据库
- [Sigma.js](https://www.sigmajs.org/) - WebGL 图渲染
- [transformers.js](https://huggingface.co/docs/transformers.js) - 浏览器 ML
- [Graphology](https://graphology.github.io/) - 图数据结构
- [MCP](https://modelcontextprotocol.io/) - MCP

---

## ⚠️ 重要提示

**GitNexus 没有官方的加密货币、代币或币。** 任何在 Pump.fun 或其他平台上使用 GitNexus 名称的代币/币都**与此项目或其维护者无关、未获认可或未创建**。请勿购买任何声称与 GitNexus 相关的加密货币。
