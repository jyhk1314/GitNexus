import type { PipelineProgress } from '../types/pipeline';

/** 将服务端 clone-analyze SSE 阶段文案映射为 LoadingOverlay 主标题 */
export function getCloneAnalyzePhaseLabel(
  phase: string,
  percent: number,
  filesProcessed?: number,
  totalFiles?: number
): string {
  if (phase === 'already_exists') return '仓库已存在，正在连接…';
  if (phase === 'cloning') return `正在克隆... ${percent.toFixed(1)}%`;
  if (phase === 'converting') return `正在转换编码... ${percent.toFixed(1)}%`;
  if (
    phase === 'Analysis complete' ||
    phase === 'connecting' ||
    phase === 'validating' ||
    phase === 'downloading' ||
    phase === 'extracting'
  ) {
    return `正在连接服务器... ${percent.toFixed(1)}%`;
  }
  if (phase === 'Loading embedding model...' || phase === 'loading-model') {
    return `正在加载向量模型... ${percent.toFixed(1)}%`;
  }
  if (phase.startsWith('Embedding')) {
    const match = phase.match(/Embedding\s+(\d+)\/(\d+)/);
    if (match) return `正在生成向量... ${match[1]}/${match[2]} 个节点 (${percent.toFixed(1)}%)`;
    return `正在生成向量... ${percent.toFixed(1)}%`;
  }
  if (phase === 'Loading into LadybugDB...' || phase.includes('LadybugDB')) {
    return `正在加载到数据库... ${percent.toFixed(1)}%`;
  }
  if (phase === 'Creating search indexes...' || phase.includes('search indexes')) {
    return `正在创建搜索索引... ${percent.toFixed(1)}%`;
  }
  if (phase.includes('Restoring') && phase.includes('cached embeddings')) {
    return `正在恢复缓存的向量... ${percent.toFixed(1)}%`;
  }
  if (phase === 'Saving metadata...') return `正在保存元数据... ${percent.toFixed(1)}%`;
  if (phase.includes('Generating skill files')) return `正在生成技能文件... ${percent.toFixed(1)}%`;
  if (phase === 'Caching embeddings...') return `正在缓存向量... ${percent.toFixed(1)}%`;
  if (
    phase === 'analyzing' ||
    phase === 'Scanning files' ||
    phase === 'Building structure' ||
    phase === 'Parsing code' ||
    phase === 'Resolving imports' ||
    phase === 'Tracing calls' ||
    phase === 'Extracting inheritance' ||
    phase === 'Detecting communities' ||
    phase === 'Detecting processes' ||
    phase === 'Pipeline complete'
  ) {
    if (filesProcessed !== undefined && totalFiles) {
      return `正在分析代码... ${filesProcessed}/${totalFiles} 个文件 (${percent.toFixed(1)}%)`;
    }
    return `正在分析代码... ${percent.toFixed(1)}%`;
  }
  return `分析中... ${percent.toFixed(1)}%`;
}

/** 将 clone-analyze 回调的 phaseRaw + percent 转为 PipelineProgress（供 LoadingOverlay） */
export function cloneAnalyzeProgressFromServer(phaseRaw: string, percent: number): PipelineProgress {
  const fileMatch = phaseRaw.match(/^(.+)\|(\d+)\|(\d+)$/);
  const phase = fileMatch ? fileMatch[1] : phaseRaw;
  const filesProcessed = fileMatch ? parseInt(fileMatch[2], 10) : undefined;
  const totalFiles = fileMatch ? parseInt(fileMatch[3], 10) : undefined;
  const displayPercent =
    filesProcessed !== undefined && totalFiles
      ? Math.max(percent, 5 + Math.round((filesProcessed / totalFiles) * 45))
      : percent;
  const message = getCloneAnalyzePhaseLabel(phase, percent, filesProcessed, totalFiles);
  const stats =
    filesProcessed !== undefined && totalFiles
      ? { filesProcessed, totalFiles, nodesCreated: 0 }
      : undefined;
  return {
    phase: 'extracting',
    percent: Math.min(100, Math.round(displayPercent)),
    message,
    detail: phase,
    stats,
  };
}
