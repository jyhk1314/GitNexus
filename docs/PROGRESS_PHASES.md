# 进度阶段映射文档

本文档记录了 Local Git clone-analyze 流程中所有的进度阶段命名。

## 阶段流程（按顺序）

### 1. Clone 阶段 (0-3%)
- `'cloning'` - Git clone 进行中
- `'converting'` - UTF-8 转换阶段

### 2. Analyze 阶段 (5-95%)

#### 2.1 Pipeline 阶段 (5-59%)
- `'analyzing'` - Analyze 开始（后端发送）
- `'Caching embeddings...'` - 缓存已有向量
- `'Scanning files'` - 扫描文件
- `'Building structure'` - 构建结构
- `'Parsing code'` - 解析代码
- `'Resolving imports'` - 解析导入
- `'Tracing calls'` - 追踪调用
- `'Extracting inheritance'` - 提取继承
- `'Detecting communities'` - 检测社区
- `'Detecting processes'` - 检测流程
- `'Pipeline complete'` - 管道完成

#### 2.2 LadybugDB 加载阶段 (59-82.5%)
- `'Loading into LadybugDB...'` - 加载到数据库（统一阶段名）

#### 2.3 FTS 索引创建阶段 (82.5-86%)
- `'Creating search indexes...'` - 创建搜索索引

#### 2.4 向量恢复阶段 (88%)
- `'Restoring X cached embeddings...'` - 恢复缓存的向量（X 为数量）

#### 2.5 向量生成阶段 (86-93.2%)
- `'Loading embedding model...'` - 加载向量模型
- `'Embedding X/Y'` - 生成向量（X/Y 为已处理/总数）

#### 2.6 完成阶段 (93.2-95%)
- `'Saving metadata...'` - 保存元数据
- `'Generating skill files...'` - 生成技能文件（如果启用）

### 3. 连接阶段 (95-100%)
- `'connecting'` - 连接到服务器并下载图数据

## 特殊阶段

- `'already_exists'` - 仓库已存在，跳转到 server 模式
- `'clone_done'` - Clone 完成（前端内部使用）

## 前端显示映射

前端会根据 phase 显示不同的文本：

1. **已存在**: `'仓库已存在，正在连接…'`
2. **克隆**: `'正在克隆... X%'` (cloning, converting)
3. **向量模型加载**: `'正在加载向量模型... X%'` (Loading embedding model..., loading-model)
4. **向量生成**: `'正在生成向量... X/Y 个节点 (Z%)'` (Embedding X/Y)
5. **数据库加载**: `'正在加载到数据库... X%'` (Loading into LadybugDB...)
6. **搜索索引**: `'正在创建搜索索引... X%'` (Creating search indexes...)
7. **恢复向量**: `'正在恢复缓存的向量... X%'` (Restoring X cached embeddings...)
8. **保存元数据**: `'正在保存元数据... X%'` (Saving metadata...)
9. **生成技能文件**: `'正在生成技能文件... X%'` (Generating skill files...)
10. **缓存向量**: `'正在缓存向量... X%'` (Caching embeddings...)
11. **分析代码**: `'正在分析代码... X%'` (其他所有 pipeline 相关阶段)
12. **默认**: `'分析中... X%'` (未知阶段)

## 注意事项

1. **阶段命名必须一致**: 后端发送的 phase 必须与前端判断逻辑匹配
2. **避免动态阶段名**: 动态消息（如 `"Loading nodes 1/10: File"`）应统一为固定阶段名
3. **阶段优先级**: 前端判断按优先级从高到低匹配，确保特殊阶段优先显示
