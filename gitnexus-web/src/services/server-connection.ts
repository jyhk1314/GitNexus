import { GraphNode, GraphRelationship } from '../core/graph/types';

export interface RepoSummary {
  name: string;
  path: string;
  indexedAt: string;
  lastCommit: string;
  stats: {
    files: number;
    nodes: number;
    edges: number;
    communities: number;
    processes: number;
  };
}

export interface ServerRepoInfo {
  name: string;
  repoPath: string;
  indexedAt: string;
  stats: {
    files: number;
    nodes: number;
    edges: number;
    communities: number;
    processes: number;
  };
}

export interface ConnectToServerResult {
  nodes: GraphNode[];
  relationships: GraphRelationship[];
  fileContents: Record<string, string>;
  repoInfo: ServerRepoInfo;
}

export function normalizeServerUrl(input: string): string {
  let url = input.trim();

  // Strip trailing slashes
  url = url.replace(/\/+$/, '');

  // Add protocol if missing
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (url.startsWith('localhost') || url.startsWith('127.0.0.1')) {
      url = `http://${url}`;
    } else {
      url = `https://${url}`;
    }
  }

  // Add /api if not already present
  if (!url.endsWith('/api')) {
    url = `${url}/api`;
  }

  return url;
}

/**
 * 通过后端 clone-analyze 拉取并建索引，代码落在 serve 机器的 ginexus_code 目录。
 * 要求 serverBaseUrl 为能访问到 gitnexus serve 的地址（如 http://10.128.128.88:6660）。
 */
export async function cloneAnalyzeOnServer(
  serverBaseUrl: string,
  gitUrl: string,
  token: string | undefined,
  onProgress: (phase: string, percent: number) => void,
  signal?: AbortSignal,
  branch?: string
): Promise<void> {
  const baseUrl = normalizeServerUrl(serverBaseUrl);
  const url = `${baseUrl}/repos/clone-analyze`;
  const body: Record<string, string> = { url: gitUrl };
  if (token) body.token = token;
  if (branch) body.branch = branch;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || `Server ${res.status}`);
  }
  const contentType = res.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    const data = (await res.json()) as { ok?: boolean; alreadyExists?: boolean; error?: string };
    if (data.alreadyExists && data.ok) {
      onProgress('already_exists', 100);
      return;
    }
    throw new Error(data.error || 'Request failed');
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const dataLine = line.match(/^data:\s*(.+)$/m)?.[1];
      if (!dataLine) continue;
      try {
        const data = JSON.parse(dataLine) as { type: string; phase?: string; percent?: number; filesProcessed?: number; totalFiles?: number; ok?: boolean; error?: string; alreadyExists?: boolean; path?: string };
        if (data.type === 'clone_done') {
          onProgress('clone_done', 5);
        } else if (data.type === 'progress' && data.phase != null) {
          // 传递文件数量信息（如果有）；只要有 filesProcessed/totalFiles 就编码进 phase 字符串
          const hasFiles = data.filesProcessed !== undefined && data.totalFiles !== undefined && data.totalFiles > 0;
          const phaseWithFiles = hasFiles
            ? `${data.phase}|${data.filesProcessed}|${data.totalFiles}`
            : data.phase;
          onProgress(phaseWithFiles, typeof data.percent === 'number' ? data.percent : 0);
        } else if (data.type === 'done') {
          if (data.alreadyExists && data.ok) {
            onProgress('already_exists', 100);
            return;
          }
          if (!data.ok) throw new Error(data.error || 'clone-analyze failed');
          return;
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  throw new Error('clone-analyze stream ended without done');
}

/**
 * 通过后端 zip-upload-analyze 上传 ZIP 并建索引，代码落在 serve 机器的 ginexus_code 目录。
 * 要求 serverBaseUrl 为能访问到 gitnexus serve 的地址。
 */
export async function uploadZipAnalyzeOnServer(
  serverBaseUrl: string,
  file: File,
  onProgress: (phase: string, percent: number) => void,
  signal?: AbortSignal
): Promise<{ repoName: string }> {
  const baseUrl = normalizeServerUrl(serverBaseUrl);
  const url = `${baseUrl}/repos/zip-upload-analyze`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Zip-Name': file.name,
    },
    body: file,
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || `Server ${res.status}`);
  }
  const contentType = res.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    const data = (await res.json()) as { ok?: boolean; alreadyExists?: boolean; repoName?: string; error?: string };
    if (data.alreadyExists && data.ok) {
      onProgress('already_exists', 100);
      return { repoName: data.repoName ?? (file.name.replace(/\.zip$/i, '') + '_zip') };
    }
    throw new Error(data.error || 'Request failed');
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const dataLine = line.match(/^data:\s*(.+)$/m)?.[1];
      if (!dataLine) continue;
      try {
        const data = JSON.parse(dataLine) as { type: string; phase?: string; percent?: number; ok?: boolean; error?: string; repoName?: string };
        if (data.type === 'extract_done') {
          onProgress('extract_done', 5);
        } else if (data.type === 'progress' && data.phase != null) {
          onProgress(data.phase, typeof data.percent === 'number' ? data.percent : 0);
        } else if (data.type === 'done') {
          if (!data.ok) throw new Error(data.error || 'zip-upload-analyze failed');
          return { repoName: data.repoName ?? (file.name.replace(/\.zip$/i, '') + '_zip') };
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  throw new Error('zip-upload-analyze stream ended without done');
}

export async function fetchRepos(baseUrl: string): Promise<RepoSummary[]> {
  const response = await fetch(`${baseUrl}/repos`);
  if (!response.ok) throw new Error(`Server returned ${response.status}`);
  return response.json();
}

export async function fetchRepoInfo(baseUrl: string, repoName?: string): Promise<ServerRepoInfo> {
  const url = repoName ? `${baseUrl}/repo?repo=${encodeURIComponent(repoName)}` : `${baseUrl}/repo`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Server returned ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  // npm gitnexus@1.3.3 returns "path"; git HEAD returns "repoPath"
  return { ...data, repoPath: data.repoPath ?? data.path };
}

export async function fetchGraph(
  baseUrl: string,
  onProgress?: (downloaded: number, total: number | null) => void,
  signal?: AbortSignal,
  repoName?: string
): Promise<{ nodes: GraphNode[]; relationships: GraphRelationship[] }> {
  const url = repoName ? `${baseUrl}/graph?repo=${encodeURIComponent(repoName)}` : `${baseUrl}/graph`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Server returned ${response.status}: ${response.statusText}`);
  }

  const contentLength = response.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength, 10) : null;

  if (!response.body) {
    const data = await response.json();
    return data;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    downloaded += value.length;
    onProgress?.(downloaded, total);
  }

  const combined = new Uint8Array(downloaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const text = new TextDecoder().decode(combined);
  return JSON.parse(text);
}

export function extractFileContents(nodes: GraphNode[]): Record<string, string> {
  const contents: Record<string, string> = {};
  for (const node of nodes) {
    if (node.label === 'File' && (node.properties as any).content) {
      contents[node.properties.filePath] = (node.properties as any).content;
    }
  }
  return contents;
}

export async function connectToServer(
  url: string,
  onProgress?: (phase: string, downloaded: number, total: number | null) => void,
  signal?: AbortSignal,
  repoName?: string
): Promise<ConnectToServerResult> {
  const baseUrl = normalizeServerUrl(url);

  // Phase 1: Validate server
  onProgress?.('validating', 0, null);
  const repoInfo = await fetchRepoInfo(baseUrl, repoName);

  // Phase 2: Download graph
  onProgress?.('downloading', 0, null);
  const { nodes, relationships } = await fetchGraph(
    baseUrl,
    (downloaded, total) => onProgress?.('downloading', downloaded, total),
    signal,
    repoName
  );

  // Phase 3: Extract file contents
  onProgress?.('extracting', 0, null);
  const fileContents = extractFileContents(nodes);

  return { nodes, relationships, fileContents, repoInfo };
}
