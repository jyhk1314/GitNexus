import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import LightningFS from '@isomorphic-git/lightning-fs';
import { shouldIgnorePath } from '../config/ignore-service';
import { FileEntry } from './zip';

// Initialize virtual filesystem (persists in IndexedDB)
// Use a unique name each time to avoid stale data issues
let fs: LightningFS;
let pfs: any;

const initFS = () => {
  // Create a fresh filesystem instance
  const fsName = `gitnexus-git-${Date.now()}`;
  fs = new LightningFS(fsName);
  pfs = fs.promises;
  return fsName;
};

// Hosted proxy URL - use this for localhost to avoid local proxy issues
const HOSTED_PROXY_URL = 'https://gitnexus.vercel.app/api/proxy';

/**
 * Custom HTTP client that uses a query-param based proxy
 * - In development (localhost): uses the hosted Vercel proxy for reliability
 * - In production: uses the local /api/proxy endpoint
 */
const createProxiedHttp = (): typeof http => {
  const isDev = typeof window !== 'undefined' && window.location.hostname === 'localhost';
  
  return {
    request: async (config) => {
      // Use hosted proxy for localhost, local proxy for production
      const proxyBase = isDev ? HOSTED_PROXY_URL : '/api/proxy';
      const proxyUrl = `${proxyBase}?url=${encodeURIComponent(config.url)}`;
      
      // Call the original http.request with the proxied URL
      return http.request({
        ...config,
        url: proxyUrl,
      });
    },
  };
};

/**
 * Parse GitHub URL to extract owner and repo
 * Supports: 
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo.git
 *   - github.com/owner/repo
 */
export const parseGitHubUrl = (url: string): { owner: string; repo: string } | null => {
  const cleaned = url.trim().replace(/\.git$/, '');
  const match = cleaned.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  
  if (!match) return null;
  
  return {
    owner: match[1],
    repo: match[2],
  };
};

/**
 * Parse any Git URL to get clone URL and a safe directory name.
 * Supports https://host/path/repo, https://host/path/repo.git, etc.
 */
export const parseGenericGitUrl = (url: string): { cloneUrl: string; dirName: string } | null => {
  const trimmed = url.trim();
  if (!trimmed) return null;
  let cloneUrl = trimmed.replace(/\.git$/i, '');
  if (!/^https?:\/\//i.test(cloneUrl)) return null;
  if (!cloneUrl.includes('/')) return null;
  cloneUrl = cloneUrl + (cloneUrl.endsWith('.git') ? '' : '.git');
  const segments = trimmed.replace(/\.git$/i, '').split('/').filter(Boolean);
  const dirName = segments[segments.length - 1] || 'repo';
  return { cloneUrl, dirName };
};

/**
 * 私有仓库鉴权：只用 Authorization 头传令牌
 */
function createHttpWithToken(token: string): typeof http {
  const basic = btoa(`${token}:`);
  return {
    request: async (config: Parameters<typeof http.request>[0]) => {
      const headers = { ...(config.headers || {}) } as Record<string, string>;
      headers['Authorization'] = `Basic ${basic}`;
      return http.request({ ...config, headers });
    },
  };
}

/**
 * 通过本地代理访问 Git：所有请求发往 proxyBase?url=真实GitURL，由代理转发（解决跨域）.
 * 可选带 token，请求头会一并发给代理，由代理转发到 Git 服务端。
 */
function createProxiedHttpForLocal(
  proxyBase: string,
  token?: string
): typeof http {
  const stripTrailingSlash = (s: string) => s.replace(/\/+$/, '');
  const base = stripTrailingSlash(proxyBase);
  return {
    request: async (config: Parameters<typeof http.request>[0]) => {
      const proxyUrl = `${base}?url=${encodeURIComponent(config.url)}`;
      const headers = { ...(config.headers || {}) } as Record<string, string>;
      if (token?.trim()) {
        headers['Authorization'] = `Basic ${btoa(`${token.trim()}:`)}`;
      }
      return http.request({
        ...config,
        url: proxyUrl,
        headers,
      });
    },
  };
}

/**
 * Clone any Git repository over HTTPS (private / self-hosted).
 * - 若填了 proxyUrl：所有请求经代理转发，避免跨域；token 通过请求头发给代理。
 * - 未填 proxyUrl：直连 Git（私有/内网易遇 CORS，建议填代理）。
 *
 * @param url - Git 仓库 HTTPS 地址
 * @param onProgress - 进度回调
 * @param options - token 访问令牌；proxyUrl 本地代理地址（如 http://localhost:8080 或能访问该 Git 的代理）
 */
export const cloneGenericGitRepository = async (
  url: string,
  onProgress?: (phase: string, progress: number) => void,
  options?: { token?: string; proxyUrl?: string }
): Promise<FileEntry[]> => {
  const parsed = parseGenericGitUrl(url);
  if (!parsed) {
    throw new Error('Invalid Git URL. Use HTTPS format: https://host/path/repo or https://host/path/repo.git');
  }

  const fsName = initFS();
  const dir = `/${parsed.dirName}`;

  const tokenTrimmed = options?.token?.trim();
  let proxyTrimmed = options?.proxyUrl?.trim();
  // 若填的是 gitnexus serve 根地址，自动补上 /api/proxy
  if (proxyTrimmed && !/\/api\/proxy\/?$/i.test(proxyTrimmed)) {
    const base = proxyTrimmed.replace(/\/+$/, '');
    proxyTrimmed = `${base}/api/proxy`;
  }
  const httpClient = proxyTrimmed
    ? createProxiedHttpForLocal(proxyTrimmed, tokenTrimmed || undefined)
    : tokenTrimmed
      ? createHttpWithToken(tokenTrimmed)
      : http;

  try {
    onProgress?.('cloning', 0);

    await git.clone({
      fs,
      http: httpClient,
      dir,
      url: parsed.cloneUrl,
      depth: 1,
      singleBranch: true,
      ref: 'master',
      onProgress: (event) => {
        if (event.total) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress?.('cloning', percent);
        }
      },
    });

    onProgress?.('reading', 0);

    const files = await readAllFiles(dir, dir);

    await removeDirectory(dir);
    try {
      indexedDB.deleteDatabase(fsName);
    } catch {}

    onProgress?.('complete', 100);

    return files;
  } catch (error) {
    try {
      await removeDirectory(dir);
      indexedDB.deleteDatabase(fsName);
    } catch {}
    throw error;
  }
};

/**
 * Clone a GitHub repository using isomorphic-git
 * Returns files in the same format as extractZip for compatibility
 * 
 * @param url - GitHub repository URL
 * @param onProgress - Progress callback
 * @param token - Optional GitHub PAT for private repos (stays client-side only)
 */
export const cloneRepository = async (
  url: string,
  onProgress?: (phase: string, progress: number) => void,
  token?: string
): Promise<FileEntry[]> => {
  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    throw new Error('Invalid GitHub URL. Use format: https://github.com/owner/repo');
  }

  // Initialize fresh filesystem to avoid stale IndexedDB data
  const fsName = initFS();
  
  const dir = `/${parsed.repo}`;
  const repoUrl = `https://github.com/${parsed.owner}/${parsed.repo}.git`;

  try {
    onProgress?.('cloning', 0);

    const httpClient = createProxiedHttp();
    
    // Clone with shallow depth for speed
    await git.clone({
      fs,
      http: httpClient,
      dir,
      url: repoUrl,
      depth: 1,
      // Auth callback for private repos (PAT stays client-side)
      onAuth: token ? () => ({ username: token, password: 'x-oauth-basic' }) : undefined,
      onProgress: (event) => {
        if (event.total) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress?.('cloning', percent);
        }
      },
    });

    onProgress?.('reading', 0);

    // Read all files from the cloned repo
    const files = await readAllFiles(dir, dir);

    // Cleanup: remove the cloned repo from virtual FS to save space
    await removeDirectory(dir);
    
    // Also try to clean up the IndexedDB database
    try {
      indexedDB.deleteDatabase(fsName);
    } catch {}

    onProgress?.('complete', 100);

    return files;
  } catch (error) {
    // Cleanup on error
    try {
      await removeDirectory(dir);
      indexedDB.deleteDatabase(fsName);
    } catch {}
    
    throw error;
  }
};

/**
 * Recursively read all files from a directory in the virtual filesystem
 */
const readAllFiles = async (baseDir: string, currentDir: string): Promise<FileEntry[]> => {
  const files: FileEntry[] = [];
  
  let entries: string[];
  try {
    entries = await pfs.readdir(currentDir);
  } catch (err) {
    // Directory might not exist or be inaccessible
    console.warn(`Cannot read directory: ${currentDir}`);
    return files;
  }

  for (const entry of entries) {
    // Skip .git directory
    if (entry === '.git') continue;

    const fullPath = `${currentDir}/${entry}`;
    const relativePath = fullPath.replace(`${baseDir}/`, '');

    // Check ignore rules
    if (shouldIgnorePath(relativePath)) continue;

    // Try to stat the file - skip if it fails (broken symlinks, etc.)
    let stat;
    try {
      stat = await pfs.stat(fullPath);
    } catch {
      // Skip files that can't be stat'd (broken symlinks, permission issues)
      if (import.meta.env.DEV) {
        console.warn(`Skipping unreadable entry: ${relativePath}`);
      }
      continue;
    }

    if (stat.isDirectory()) {
      // Recurse into subdirectory
      const subFiles = await readAllFiles(baseDir, fullPath);
      files.push(...subFiles);
    } else {
      // Read file content
      try {
        const content = await pfs.readFile(fullPath, { encoding: 'utf8' }) as string;
        files.push({
          path: relativePath,
          content,
        });
      } catch {
        // Skip binary files or files that can't be read as text
      }
    }
  }

  return files;
};

/**
 * Recursively remove a directory from the virtual filesystem
 */
const removeDirectory = async (dir: string): Promise<void> => {
  try {
    const entries = await pfs.readdir(dir);
    
    for (const entry of entries) {
      const fullPath = `${dir}/${entry}`;
      const stat = await pfs.stat(fullPath);
      
      if (stat.isDirectory()) {
        await removeDirectory(fullPath);
      } else {
        await pfs.unlink(fullPath);
      }
    }
    
    await pfs.rmdir(dir);
  } catch {
    // Ignore errors during cleanup
  }
};

