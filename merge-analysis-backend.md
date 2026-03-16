# 后端代码差异分析报告

## 分析范围
- `/src/gitnexus/src/core/augmentation`
- `/src/gitnexus/src/core/ingestion`
- `/src/gitnexus/src/server/api.ts`

---

## 1. `/src/core/augmentation/engine.ts`

### 差异对比

| 项目 | 最新开源版本 | 本地改造版本 | 差异原因 |
|------|------------|------------|---------|
| **数据库框架** | `lbug` (ladybug) | `kuzu` | 最新版本引入 ladybug 替换 kuzu（框架改造） |
| **查询优化** | 批量查询（batch queries） | 逐个符号查询 | 最新版本性能优化 |
| **路径变量** | `lbugPath` | `kuzuPath` | 框架变更导致 |
| **导入路径** | `../../mcp/core/lbug-adapter.js` | `../../mcp/core/kuzu-adapter.js` | 框架变更导致 |
| **搜索函数** | `searchFTSFromLbug` | `searchFTSFromKuzu` | 框架变更导致 |

### 合并建议
**保留最新版本**，因为：
- 这是框架层面的改造（ladybug 替换 kuzu）
- 最新版本有性能优化（批量查询）
- 符合用户要求第3条：框架改造保留最新版本

---

## 2. `/src/server/api.ts`

### 差异对比

#### 2.1 数据库框架相关
| 项目 | 最新开源版本 | 本地改造版本 |
|------|------------|------------|
| **数据库适配器** | `lbug-adapter.js` | `kuzu-adapter.js` |
| **数据库路径** | `lbug` | `kuzu` |
| **函数调用** | `withLbugDb`, `closeLbug`, `searchFTSFromLbug` | `withKuzuDb`, `closeKuzu`, `searchFTSFromKuzu` |

#### 2.2 新增功能接口（本地版本独有）

**① `/api/repos/clone-analyze` (第171-351行)**
- **功能**：一键下载并分析代码仓库
- **特性**：
  - 支持从 URL clone 仓库
  - 支持 token 认证
  - 支持指定分支（branch）
  - 代码目录：`HOME` 或启动路径下的 `ginexus_code` 目录
  - 已在 registry 中则禁止重复下载
  - 自动转换字符集到 UTF-8（调用 `convert_to_utf8.py`）
  - 支持进度返回（SSE 流式响应）
  - 支持 embeddings 选项
- **对应需求**：update.log 第3条、第7条、第18条、第19条

**② `/api/repos/zip-upload-analyze` (第354-532行)**
- **功能**：ZIP 上传并分析
- **特性**：
  - 接收 ZIP 文件（最大 500MB）
  - 解压到 `ginexus_code/{zip名}_zip` 目录
  - 自动 git init（如果没有 .git）
  - 自动转换字符集到 UTF-8
  - 支持进度返回（SSE 流式响应）
  - 支持 embeddings 选项
- **对应需求**：update.log 第14条、第15条、第19条

**③ Git 代理接口 `/api/proxy` (第734-788行)**
- **功能**：Git 代理，供 Web 端 Local Git 转发请求
- **特性**：
  - 支持 GET/POST 请求
  - 解决跨域/鉴权问题
  - 仅允许 http/https URLs
  - 转发 Git 协议相关 headers
- **对应需求**：update.log 第1条（gitnexus支持对接公司git）

**④ `/api/proxy/test` (第791-834行)**
- **功能**：测试代理能否拉取指定 Git 仓库
- **特性**：
  - 测试 URL 和 token
  - 返回测试结果

#### 2.3 CORS 配置差异
- **最新版本**：严格限制，拒绝非 localhost 的请求
- **本地版本**：宽松配置，允许所有 origin（第130行：`callback(null, true)`）

#### 2.4 其他差异
- **最新版本**：`createServer` 函数签名：`(port: number, host: string = '127.0.0.1')`
- **本地版本**：`createServer` 函数签名：`(port: number, host: string = '127.0.0.1', opts?: { embeddings?: boolean })`
  - 支持 `embeddings` 选项，用于控制是否启用 embeddings

### 合并建议

**需要合并的内容**：
1. ✅ **保留最新版本的框架改造**（lbug 替换 kuzu）
2. ✅ **保留本地版本的新增接口**：
   - `/api/repos/clone-analyze`
   - `/api/repos/zip-upload-analyze`
   - `/api/proxy` 和 `/api/proxy/test`
3. ✅ **保留本地版本的 CORS 配置**（允许所有 origin，便于公司内网访问）
4. ✅ **保留本地版本的 embeddings 选项**（`opts?.embeddings`）

**合并策略**：
- 将本地版本的新增接口和功能合并到最新版本
- 将所有 `kuzu` 相关调用替换为 `lbug`
- 保持最新版本的代码结构和优化

---

## 3. `/src/core/ingestion/call-processor.ts`

### 差异对比

#### 3.1 架构差异

**最新版本**：
- 使用 `ResolutionContext` 统一管理符号解析
- 使用 `call-routing` 进行调用路由
- 支持类型环境（type-env）和构造函数绑定
- 更复杂的调用解析逻辑（支持接收者类型、参数计数、调用形式等）

**本地版本**：
- 使用 `SymbolTable` 和 `ImportMap` 分离管理
- 没有 call-routing 机制
- 更简单的调用解析逻辑

#### 3.2 C++ 特殊处理（本地版本独有）

**文件引用关系检查**（第261-266行）：
```typescript
const filesHaveReference = (fileA: string, fileB: string, importMap: ImportMap): boolean => {
  if (fileA === fileB) return true;
  if (importMap.get(fileA)?.has(fileB)) return true;
  if (importMap.get(fileB)?.has(fileA)) return true;
  return false;
};
```

**C++ 调用解析优化**（第308-313行）：
```typescript
if (isCpp) {
  const defWithRef = allDefs.find(def => filesHaveReference(currentFile, def.filePath, importMap));
  if (!defWithRef) return null;
  const confidence = allDefs.length === 1 ? 0.5 : 0.3;
  return { nodeId: defWithRef.nodeId, confidence, reason: 'fuzzy-global' };
}
```

**功能说明**：
- 对于 C++，只有当调用者和被调用者文件有引用关系（include/import）时才创建 CALLS 关系
- 避免同名函数误匹配问题
- **对应需求**：update.log 第2条、第8条

#### 3.3 其他差异

| 项目 | 最新版本 | 本地版本 |
|------|---------|---------|
| **函数签名** | `processCalls(..., ctx: ResolutionContext, ...)` | `processCalls(..., symbolTable: SymbolTable, importMap: ImportMap, ...)` |
| **返回值** | `Promise<ExtractedHeritage[]>` | `Promise<void>` |
| **调用解析** | 使用 `ctx.resolve()` 进行分层解析 | 使用 `symbolTable.lookupExact/lookupFuzzy` |
| **接收者类型** | 支持类型环境推断 | 不支持 |
| **参数计数** | 支持参数计数过滤 | 不支持 |

### 合并建议

**需要合并的内容**：
1. ✅ **保留最新版本的架构**（ResolutionContext、call-routing、type-env）
2. ✅ **保留本地版本的 C++ 特殊处理逻辑**
   - 文件引用关系检查函数
   - C++ 调用解析优化（仅在文件有引用关系时创建 CALLS）

**合并策略**：
- 在最新版本的 `resolveCallTarget` 函数中添加 C++ 特殊处理逻辑
- 需要访问 `importMap` 来检查文件引用关系
- 可能需要调整 `ResolutionContext` 以支持文件引用关系查询

---

## 4. `/src/core/ingestion/pipeline.ts`

### 差异对比

#### 4.1 架构差异

**最新版本**：
- 使用 `ResolutionContext`（包含 `symbols` 属性）
- 使用 `createResolutionContext()` 创建上下文
- 并行处理 calls/heritage/routes（`Promise.all`）
- 添加了 MRO（Method Resolution Order）处理阶段（第325-336行）
- 更详细的进度报告和缓存统计

**本地版本**：
- 使用独立的 `SymbolTable` 和 `ImportMap`
- 顺序处理 calls/heritage/routes
- 没有 MRO 处理

#### 4.2 函数调用差异

**最新版本**：
```typescript
await processImportsFromExtracted(graph, allPathObjects, chunkWorkerData.imports, ctx, ...);
await processCallsFromExtracted(graph, chunkWorkerData.calls, ctx, ...);
await processHeritageFromExtracted(graph, chunkWorkerData.heritage, ctx, ...);
await processRoutesFromExtracted(graph, chunkWorkerData.routes ?? [], ctx, ...);
```

**本地版本**：
```typescript
await processImportsFromExtracted(graph, allPathObjects, chunkWorkerData.imports, importMap, ...);
await processCallsFromExtracted(graph, chunkWorkerData.calls, symbolTable, importMap);
await processHeritageFromExtracted(graph, chunkWorkerData.heritage, symbolTable);
await processRoutesFromExtracted(graph, chunkWorkerData.routes, symbolTable, importMap);
```

#### 4.3 MRO 处理（最新版本独有）

**第325-336行**：
```typescript
// ── Phase 4.5: Method Resolution Order ──────────────────────────────
onProgress({
  phase: 'parsing',
  percent: 81,
  message: 'Computing method resolution order...',
  ...
});

const mroResult = computeMRO(graph);
```

**功能说明**：
- 计算方法的解析顺序（主要用于多继承语言如 Python、Ruby）
- 生成 `OVERRIDES` 关系边

#### 4.4 Worker Pool 处理差异

**最新版本**（第160-173行）：
- 增加了 vitest 测试环境的兼容性处理
- 如果源文件不存在，尝试从 dist 目录加载 worker

**本地版本**（第141-147行）：
- 简单的 worker pool 创建，没有测试环境兼容

### 合并建议

**需要合并的内容**：
1. ✅ **保留最新版本的架构**（ResolutionContext、并行处理、MRO）
2. ✅ **保留最新版本的优化**（worker pool 测试兼容、缓存统计）
3. ⚠️ **注意**：如果本地版本的 C++ 特殊处理需要 `importMap`，需要确保 `ResolutionContext` 能够提供文件引用关系查询

**合并策略**：
- 使用最新版本的 pipeline 结构
- 确保 `ResolutionContext` 支持本地版本需要的功能（文件引用关系查询）

---

## 总结

### 需要合并到最新版本的本地改造功能

1. **api.ts**：
   - `/api/repos/clone-analyze` 接口
   - `/api/repos/zip-upload-analyze` 接口
   - `/api/proxy` 和 `/api/proxy/test` 接口
   - CORS 宽松配置
   - embeddings 选项支持

2. **call-processor.ts**：
   - C++ 文件引用关系检查逻辑
   - C++ 调用解析优化（仅在文件有引用关系时创建 CALLS）

### 需要保留的最新版本改造

1. **框架改造**：
   - ladybug 替换 kuzu（所有文件）
   - ResolutionContext 架构（ingestion 相关文件）

2. **性能优化**：
   - 批量查询优化（augmentation/engine.ts）
   - 并行处理（pipeline.ts）
   - Worker pool 测试兼容（pipeline.ts）

3. **新功能**：
   - MRO 处理（pipeline.ts）
   - 类型环境支持（call-processor.ts）

### 合并难点

1. **C++ 特殊处理与 ResolutionContext 的集成**：
   - 本地版本的 C++ 处理需要 `importMap` 来检查文件引用关系
   - 最新版本使用 `ResolutionContext`，需要确保能够提供相同的功能

2. **函数签名差异**：
   - 多个函数的参数从 `(symbolTable, importMap)` 变为 `(ctx)`
   - 需要确保所有调用点都更新

### 下一步行动

1. 先合并 `api.ts`（相对独立，影响较小）
2. 再处理 `call-processor.ts` 的 C++ 特殊处理（需要与 ResolutionContext 集成）
3. 最后验证 `pipeline.ts` 的集成（确保所有调用链正确）
