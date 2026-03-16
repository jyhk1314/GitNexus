# Difflog

本文档记录当前仓库版本与原分支的差异点, 部分个性化需求不会再往原分支主动同步

## 与 https://github.com/abhigyanpatwari/GitNexus v1.4.0 差异内容分析:

### 后台服务

#### 一、gitnexus/scripts

**中文本地化支撑：**

1. **convert_to_utf8.py - gitnexus下载仓库后自动转换所有字符集到UTF8**

#### 二、gitnexus/src/server

**核心功能增强及新增API端点：**

1. **api.ts - 表名转义处理，添加BACKTICK_TABLES集合和escapeTableName函数，确保Cypher查询中特殊表名（Struct、Enum、Macro等）能正确执行**
2. **api.ts - createServer函数增强，新增embeddings选项参数，支持在启动时启用embeddings功能**
3. **api.ts - POST /api/repos/clone-analyze，一键克隆并分析仓库，支持token认证、分支指定、流式响应、UTF-8编码转换、智能进度跟踪、已存在场景处理**
4. **api.ts - POST /api/repos/zip-upload-analyze，ZIP上传并分析，支持最大500MB、自动处理单层目录、自动git init、UTF-8编码转换、流式响应**
5. **api.ts - GET/POST /api/proxy，Git代理服务，为Web端Local Git提供代理转发解决跨域和鉴权问题**
6. **api.ts - 数据库连接管理，分析完成后调用closeLbugForPath释放文件锁，避免后台服务持有数据库连接**
7. **api.ts - 导入依赖扩展，新增文件系统操作、进程管理、ZIP处理等功能**
8. **api.ts - 错误处理和日志优化，更详细的错误处理、过滤噪音日志、完善流式响应错误处理**
9. **api.ts - 路径处理工具函数，getCodeBaseDir、getCodeDir、getRepoNameFromUrl、pathEquals等跨平台路径处理**

#### 三、gitnexus/src/mcp/core

**中文本地化支撑：**

1. **embedder.ts - 强制写死hf镜像站**

#### 四、gitnexus/src/cli

**CLI命令增强：**

1. **index.ts - serve命令增强，默认端口从4747改为6660，新增--embeddings选项**
2. **serve.ts - 服务启动增强，新增embeddings选项支持，默认端口改为6660**
3. **analyze.ts - 分析命令增强，新增JSON格式进度输出（GITNEXUS_PROGRESS），支持filesProcessed和totalFiles字段，调整进度百分比，优化LadybugDB阶段和错误处理**
4. **skill-gen.ts - 技能生成配置化，新增SkillConfig接口和loadSkillConfig函数，支持从.gitnexus/skill-config.json读取配置，社区目录过滤配置化**

#### 五、gitnexus/src/core

**核心模块增强：**

1. **embeddings/embedder.ts - 中文本地化支撑，添加Hugging Face镜像站配置（hf-mirror.com），避免直连慢或不可用**
2. **ingestion/community-processor.ts - 社区检测优化，扩展通用目录过滤列表，新增app和helper目录名**
3. **ingestion/constants.ts - Tree-sitter缓冲区大小优化，从512KB提升到2MB，避免跳过较大文件**
4. **ingestion/filesystem-walker.ts - 文件大小限制优化，从512KB提升到2MB**
5. **lbug/lbug-adapter.ts - 数据库适配器，包含closeLbugForPath、getEmbeddingTableName、BACKTICK_TABLES、escapeTableName等功能**
6. **ingestion/parsing-processor.ts - 进度优化**
7. **ingestion/pipeline.ts - 进度优化**

#### 六、gitnexus-web/src/lib

**C++场景增强：**

1. **constants.ts - 节点类型和样式配置扩展，新增Struct和Macro节点类型支持，扩展可过滤标签（Struct、Enum、Macro），CONTAINS关系颜色从深绿色改为黄色**
2. **graph-adapter.ts - 图形渲染适配器，CONTAINS关系颜色从深绿色改为黄色，与constants.ts保持一致**

#### 七、gitnexus-web/src/types

**Pipeline类型增强：**

1. **pipeline.ts - PipelineResult和SerializablePipelineResult接口增强，新增lbugReady字段标识LadybugDB/KuzuDB加载状态，serializePipelineResult和deserializePipelineResult函数支持传递数据库就绪状态**

#### 八、gitnexus-web/src/workers

**Worker功能增强：**

1. **ingestion.worker.ts - 导入依赖扩展，新增loadSettings用于读取用户配置的递归限制等设置**
2. **ingestion.worker.ts - HTTP API路径调整，去掉/api前缀（/query、/search），与后端服务路由保持一致**
3. **ingestion.worker.ts - runPipeline和runPipelineFromFiles方法增强，新增lbugReady状态跟踪，添加错误日志输出，返回时传递数据库加载状态**
4. **ingestion.worker.ts - chatStream方法增强，新增recursionLimit参数支持，实现优先级：参数 > 用户设置 > 默认值100**

#### 九、gitnexus-web/src/services

**服务层功能增强：**

1. **server-connection.ts - 新增cloneAnalyzeOnServer函数，通过后端clone-analyze API拉取Git仓库并建索引，支持token认证、分支指定、流式响应、已存在场景处理、文件数量进度信息**
2. **server-connection.ts - 新增uploadZipAnalyzeOnServer函数，通过后端zip-upload-analyze API上传ZIP文件并建索引，支持最大500MB、流式响应、已存在场景处理**
3. **git-clone.ts - 新增parseGenericGitUrl函数，解析任意Git URL（不仅限于GitHub）**
4. **git-clone.ts - 新增cloneGenericGitRepository函数，克隆任意Git仓库（私有/内网/自托管），支持代理模式和token认证**
5. **git-clone.ts - 新增createProxiedHttpForLocal和createHttpWithToken辅助函数，支持代理转发和token认证**
6. **git-clone.ts - 代理路径自动补全，如果proxyUrl不是以/api/proxy结尾则自动补全**
7. **backend.ts - 默认端口从4747改为6660，与CLI服务端口保持一致**
8. **saved-queries-service.ts - 新增文件，保存的查询服务，持久化用户Cypher查询到localStorage，支持内置查询和用户自定义查询**

#### 十、gitnexus-web/src/hooks

**Hooks功能增强：**

1. **useAppState.tsx - 应用状态管理增强，新增serverRepoName状态、setEmbeddingError、initializeBackendAgent、clearAgentError方法，runQuery和isDatabaseReady支持Server模式，sendChatMessage支持递归限制和Embedding状态检查，switchRepo支持状态清理和Backend Agent**
2. **useSigma.ts - 图形可视化Hook增强，新增autoLayoutOnSetGraph选项控制布局，focusNode方法新增force参数和聚焦逻辑优化**
3. **useBackend.ts - 默认URL从4747改为6660，与CLI服务端口保持一致**

#### 十一、gitnexus-web/src/components

**组件功能增强：**

1. **DropZone.tsx - 文件上传和仓库连接组件增强，新增onZipUploadToServer prop和localgit tab，支持Local Git和ZIP Upload代理模式，新增状态管理（localGitUrl、localGitToken、localGitBranch、localGitProxyUrl、zipProxyUrl、serverRepoName等），进度状态增强支持文件数量，URL参数支持，新增handleZipFile和handleLocalGitClone函数，详细的进度阶段映射（中文），Server Tab增强新增serverRepoName输入框和说明文字**
2. **GraphCanvas.tsx - 图形画布组件增强，节点点击聚焦增强，Ref暴露增强使用双重requestAnimationFrame延迟调用和force参数，聚焦选中节点增强**
3. **QueryFAB.tsx - Cypher查询浮动按钮组件增强，查询保存功能（localStorage），内置查询从5个扩展到13个（中文标签），结果分页功能（50条/页），保存查询UI和查询列表UI改进**
4. **RightPanel.tsx - 右侧面板组件增强，递归限制配置功能，错误处理改进（可关闭错误提示），LLM设置集成，状态栏布局改进**
5. **SettingsPanel.tsx - 设置面板组件增强，模型搜索功能（SearchableModelCombobox），OpenAI和Ollama模型加载功能，OpenRouter模型选择改进，后端URL默认值从4747改为6660**

#### 十二、gitnexus-web/src/core

**C++场景支撑、大模型操作优化及界面优化：**

1. **embeddings/embedder.ts - 浏览器/Worker 内用同源代理避免 CORS；支持使用hf国内直连镜像**
2. **graph/types.ts - C++场景适配节点标签增加结构体和宏**
3. **ingestion/community-processor.ts - 增加社区屏蔽公共目录名称**
4. **ingestion/utils.ts - C++场景适配关联.h及.c文件**
5. **llm/agent.ts - 模型检索增强, 暴露schema数据解构避免检索出错, 过滤空内容, 并支持递归次数配置**
6. **llm/settings-service.ts - 支持模型列表自检索**
7. **llm/tools.ts - 模型检索增强, 暴露schema数据解构避免检索出错, 增强read工具对路径依赖的限制**
8. **llm/types.ts - 大模型递归次数限制可配置**

