## 与 https://github.com/abhigyanpatwari/GitNexus 差异内容分析:

### 后台服务

#### 一、gitnexus/scripts

**中文本地化支撑：涉及文件(convert_to_utf8.py)**

1. gitnexus下载仓库后, 自动转换所有字符集到UTF8

#### 二、gitnexus/src/server

**核心功能增强：涉及文件(api.ts)**

1. **表名转义处理**
   - 添加了 `BACKTICK_TABLES` 集合和 `escapeTableName` 函数
   - 对需要反引号的表名（如 Struct、Enum、Macro 等）进行转义处理
   - 确保 Cypher 查询中特殊表名能正确执行

2. **createServer 函数增强**
   - 新增 `opts?: { embeddings?: boolean }` 参数
   - 支持在启动时启用 embeddings 功能
   - 在克隆和分析流程中传递 embeddings 选项

**新增 API 端点：涉及文件(api.ts)**

3. **`POST /api/repos/clone-analyze`** - 一键克隆并分析仓库
   - 功能：接收 Git 仓库 URL，自动克隆到 `ginexus_code` 目录并执行分析
   - 特性：
     - 支持 token 认证和分支指定
     - 流式响应（Server-Sent Events）实时返回进度
     - 自动 UTF-8 编码转换
     - 智能进度跟踪（克隆 0-5%，分析 5-95%）
     - 处理目录已存在的情况（检查 registry 和 git 仓库状态）
     - 支持 embeddings 选项
   - 进度阶段：cloning → converting → Scanning files → Analysis complete

4. **`POST /api/repos/zip-upload-analyze`** - ZIP 上传并分析
   - 功能：接收 ZIP 文件，解压到 `ginexus_code/{zip名}_zip` 并执行分析
   - 特性：
     - 支持最大 500MB 的 ZIP 文件
     - 自动处理单层目录结构（如 GitHub 下载的 zip）
     - 自动 git init（ZIP 解压没有 .git 目录）
     - 自动 UTF-8 编码转换
     - 流式响应返回进度
     - 支持 embeddings 选项

5. **`GET/POST /api/proxy`** - Git 代理服务
   - 功能：为 Web 端 Local Git 提供代理转发，解决跨域和鉴权问题
   - 特性：
     - 仅允许 http/https 协议
     - 转发 Git 协议相关 headers（Authorization、Git-Protocol 等）
     - 支持最大 50MB 的请求体
     - 详细的日志记录（请求 URL、状态、大小）

**其他改进：涉及文件(api.ts)**

6. **数据库连接管理**
   - 在分析完成后调用 `closeLbugForPath` 释放文件锁
   - 避免后台服务持有数据库连接导致的问题

7. **导入依赖扩展**
   - 新增导入：`existsSync`, `spawnSync`, `spawn`, `readline`, `fileURLToPath`, `AdmZip`, `readRegistry`, `closeLbugForPath`, `isGitRepo`
   - 支持文件系统操作、进程管理、ZIP 处理等功能

8. **错误处理和日志**
    - 更详细的错误处理（区分不同类型的错误）
    - 过滤 stderr 中的噪音日志（如 @huggingface/transformers 的警告）
    - 更完善的流式响应错误处理

9. **路径处理工具函数**
    - `getCodeBaseDir()`: 获取代码库基础目录（HOME 或当前工作目录）
    - `getCodeDir()`: 获取代码目录（`ginexus_code`）
    - `getRepoNameFromUrl()`: 从 URL 提取仓库名
    - `pathEquals()`: 跨平台路径比较（Windows 大小写不敏感）

#### 三、gitnexus/src/mcp/core

**中文本地化支撑：(涉及文件embedder.ts)**

1. 强制写死hf镜像站

#### 四、gitnexus/src/cli

**CLI 命令增强：涉及文件(index.ts, serve.ts, analyze.ts, skill-gen.ts)**

1. **index.ts - 命令定义变更**
   - **serve 命令增强**：
     - 默认端口从 `4747` 改为 `6660`
     - 新增 `--embeddings` 选项，支持在启动时启用 embeddings 功能

2. **serve.ts - 服务启动增强**
   - 新增 `embeddings` 选项支持
   - 默认端口从 `4747` 改为 `6660`
   - 将 `embeddings` 选项传递给 `createServer` 函数

3. **analyze.ts - 分析命令增强**
   - **进度输出模式（progressMode）**：
     - 新增 JSON 格式的进度输出（通过 `GITNEXUS_PROGRESS` 环境变量启用）
     - 支持 `filesProcessed` 和 `totalFiles` 字段，便于前端显示详细进度
     - 在 progressMode 下，摘要信息输出到 stderr，避免与 stdout 的 JSON 混淆
   - **进度百分比调整**：
     - Pipeline: 0-50%（原版 0-60%）
     - LadybugDB: 50-65%（原版 60-85%）
     - FTS: 65-72%（原版 85-90%）
     - Embeddings: 72-98%（原版 90-98%）
     - Finalize: 98-100%（相同）
   - **LadybugDB 阶段优化**：
     - 使用固定的 phase 标签 "Loading into LadybugDB..."，避免动态消息导致阶段来回跳
     - 改进进度计算逻辑，使用消息计数估算进度
   - **错误处理优化**：
     - 移除 lbug 警告消息中的 "(schema will be updated in next release)" 文本
     - 改进 progressMode 下的错误输出格式

4. **skill-gen.ts - 技能生成配置化**
   - **配置管理功能**：
     - 新增 `SkillConfig` 接口，定义技能生成配置结构
     - 新增 `loadSkillConfig()` 函数，从 `.gitnexus/skill-config.json` 读取配置
     - 配置文件不存在时自动创建默认配置
     - 支持配置验证和错误处理
   - **社区目录过滤配置化**：
     - 新增 `excludedCommunityFolders` 配置项，允许自定义需要过滤的目录名
     - 默认过滤列表扩展：`['src', 'lib', 'core', 'utils', 'common', 'shared', 'helpers', 'app', 'helper']`（原版只有前7个）
     - `buildCommunitiesFromMemberships` 函数改为接收 `config` 参数，使用配置而非硬编码
   - **配置文件位置**：`.gitnexus/skill-config.json`
   - **配置文件格式**：
     ```json
     {
       "excludedCommunityFolders": [
         "src", "lib", "core", "utils", "common", "shared", "helpers", "app", "helper"
       ]
     }
     ```
