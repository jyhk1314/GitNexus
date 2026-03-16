import { useState, useCallback, useRef, DragEvent } from 'react';
import { Upload, FileArchive, Github, Loader2, ArrowRight, Key, Eye, EyeOff, Globe, X, GitBranch } from 'lucide-react';
import { cloneRepository, parseGitHubUrl, parseGenericGitUrl } from '../services/git-clone';
import { connectToServer, cloneAnalyzeOnServer, type ConnectToServerResult } from '../services/server-connection';
import { FileEntry } from '../services/zip';

interface DropZoneProps {
  onFileSelect: (file: File) => void;
  onGitClone?: (files: FileEntry[]) => void;
  onServerConnect?: (result: ConnectToServerResult, serverUrl?: string) => void;
  /** ZIP 上传到后端：当填写了代理地址时，上传 zip 到后端解压分析，完成后转为 server 模式 */
  onZipUploadToServer?: (file: File, proxyUrl: string) => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const DropZone = ({ onFileSelect, onGitClone, onServerConnect, onZipUploadToServer }: DropZoneProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<'zip' | 'github' | 'localgit' | 'server'>(() => {
    if (typeof window === 'undefined') return 'zip';
    const p = new URLSearchParams(window.location.search);
    return p.has('server') ? 'server' : 'zip';
  });
  const [githubUrl, setGithubUrl] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [localGitUrl, setLocalGitUrl] = useState(() => localStorage.getItem('gitnexus-localgit-url') || '');
  const [localGitToken, setLocalGitToken] = useState('');
  const [localGitBranch, setLocalGitBranch] = useState(() => localStorage.getItem('gitnexus-localgit-branch') || '');
  const [localGitProxyUrl, setLocalGitProxyUrl] = useState(() => localStorage.getItem('gitnexus-localgit-proxy-url') || '');
  const [zipProxyUrl, setZipProxyUrl] = useState(() => localStorage.getItem('gitnexus-zip-proxy-url') || '');
  const [isZipUploading, setIsZipUploading] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showLocalToken, setShowLocalToken] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<{ phase: string; percent: number; filesProcessed?: number; totalFiles?: number }>({ phase: '', percent: 0 });
  const [error, setError] = useState<string | null>(null);

  // Server tab state：优先从 URL 参数 server/repo 取默认值（默认 server 访问模式）
  const [serverUrl, setServerUrl] = useState(() => {
    const p = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    return p.get('server') || localStorage.getItem('gitnexus-server-url') || '';
  });
  const [serverRepoName, setServerRepoName] = useState(() => {
    const p = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    return p.get('repo') || localStorage.getItem('gitnexus-server-repo') || '';
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [serverProgress, setServerProgress] = useState<{
    phase: string;
    downloaded: number;
    total: number | null;
  }>({ phase: '', downloaded: 0, total: null });
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleZipFile = useCallback(
    async (file: File) => {
      const proxyTrimmed = zipProxyUrl.trim();
      if (proxyTrimmed && onZipUploadToServer) {
        setIsZipUploading(true);
        setError(null);
        const aborter = new AbortController();
        abortControllerRef.current = aborter;
        try {
          await onZipUploadToServer(file, proxyTrimmed);
          localStorage.setItem('gitnexus-zip-proxy-url', proxyTrimmed);
        } catch (err) {
          if ((err as Error).name === 'AbortError') return;
          console.error('ZIP upload to server failed:', err);
          setError((err as Error).message || 'ZIP 上传或分析失败');
        } finally {
          setIsZipUploading(false);
          abortControllerRef.current = null;
        }
      } else {
        onFileSelect(file);
      }
    },
    [zipProxyUrl, onZipUploadToServer, onFileSelect]
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.name.endsWith('.zip')) {
          handleZipFile(file);
        } else {
          setError('Please drop a .zip file');
        }
      }
    },
    [handleZipFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.name.endsWith('.zip')) {
          handleZipFile(file);
        } else {
          setError('Please select a .zip file');
        }
      }
    },
    [handleZipFile]
  );

  const handleGitClone = async () => {
    if (!githubUrl.trim()) {
      setError('Please enter a GitHub URL');
      return;
    }

    const parsed = parseGitHubUrl(githubUrl);
    if (!parsed) {
      setError('Invalid GitHub URL. Use format: https://github.com/owner/repo');
      return;
    }

    setError(null);
    setIsCloning(true);
    setCloneProgress({ phase: 'starting', percent: 0 });

    try {
      const files = await cloneRepository(
        githubUrl,
        (phase, percent) => setCloneProgress({ phase, percent }),
        githubToken || undefined
      );

      setGithubToken('');

      if (onGitClone) {
        onGitClone(files);
      }
    } catch (err) {
      console.error('Clone failed:', err);
      const message = err instanceof Error ? err.message : 'Failed to clone repository';
      if (message.includes('401') || message.includes('403') || message.includes('Authentication')) {
        if (!githubToken) {
          setError('This looks like a private repo. Add a GitHub PAT (Personal Access Token) to access it.');
        } else {
          setError('Authentication failed. Check your token permissions (needs repo access).');
        }
      } else if (message.includes('404') || message.includes('not found')) {
        setError('Repository not found. Check the URL or it might be private (needs PAT).');
      } else {
        setError(message);
      }
    } finally {
      setIsCloning(false);
    }
  };

  const handleLocalGitClone = async () => {
    if (!localGitUrl.trim()) {
      setError('请输入 Git 仓库 URL');
      return;
    }
    const proxyTrimmed = localGitProxyUrl.trim();
    if (!proxyTrimmed) {
      setError('请填写代理/服务地址（即运行 gitnexus serve 的地址），以便在后端执行 clone-analyze');
      return;
    }

    if (!parseGenericGitUrl(localGitUrl)) {
      setError('无效的 Git URL，请使用 HTTPS 格式，例如：https://git.example.com/org/repo.git');
      return;
    }

    setError(null);
    setIsCloning(true);
    setCloneProgress({ phase: 'starting', percent: 0 });

    const aborter = new AbortController();
    abortControllerRef.current = aborter;

    // 用于跟踪是否收到 already_exists
    let receivedAlreadyExists = false;

    try {
      // 走后端 clone-analyze：代码落在 serve 机器的 ginexus_code 目录
      await cloneAnalyzeOnServer(
        proxyTrimmed,
        localGitUrl,
        localGitToken.trim() || undefined,
        (phaseRaw, percent) => {
          // 解析 phase|filesProcessed|totalFiles 格式
          const fileMatch = phaseRaw.match(/^(.+)\|(\d+)\|(\d+)$/);
          const phase = fileMatch ? fileMatch[1] : phaseRaw;
          const filesProcessed = fileMatch ? parseInt(fileMatch[2], 10) : undefined;
          const totalFiles = fileMatch ? parseInt(fileMatch[3], 10) : undefined;
          setCloneProgress({ phase, percent, filesProcessed, totalFiles });
          if (phase === 'already_exists') {
            receivedAlreadyExists = true;
          }
        },
        aborter.signal,
        localGitBranch.trim() || undefined
      );

      // 如果收到 already_exists，自动跳转到 server 模式
      if (receivedAlreadyExists) {
        setIsCloning(false);
        // 切换到 server tab
        setActiveTab('server');
        // 设置 server URL
        setServerUrl(proxyTrimmed);
        localStorage.setItem('gitnexus-server-url', proxyTrimmed);
        // 解析仓库名
        let repoName: string | undefined;
        try {
          const u = new URL(localGitUrl);
          const segs = u.pathname.split('/').filter(Boolean);
          const baseName = segs.length ? segs[segs.length - 1].replace(/\.git$/i, '') : undefined;
          const branchTrimmed = localGitBranch.trim();
          if (baseName && branchTrimmed) {
            const branchSuffix = branchTrimmed.replace(/[^a-zA-Z0-9_\-]/g, '_');
            repoName = `${baseName}_${branchSuffix}`;
          } else {
            repoName = baseName;
          }
          if (repoName) {
            setServerRepoName(repoName);
            localStorage.setItem('gitnexus-server-repo', repoName);
          }
        } catch {
          // 忽略解析错误
        }
        setError(null);
        // 自动连接 server
        setCloneProgress({ phase: 'connecting', percent: 0 });
        const result = await connectToServer(
          proxyTrimmed,
          (phase, downloaded, total) => setCloneProgress({ phase, percent: (downloaded / (total || 1)) * 100 }),
          aborter.signal,
          repoName
        );
        if (onServerConnect) {
          onServerConnect(result, proxyTrimmed);
        }
        return; // 提前返回，不继续执行后续代码
      }

      setLocalGitToken('');
      localStorage.setItem('gitnexus-localgit-url', localGitUrl.trim());
      localStorage.setItem('gitnexus-localgit-proxy-url', proxyTrimmed);
      localStorage.setItem('gitnexus-localgit-branch', localGitBranch.trim());

      // 从 Git URL 解析仓库名，用于后续从该服务拉图
      // 若指定了分支，需与后端保持一致：目录名 = repoName + '_' + branch（特殊字符替换为 _）
      let repoName: string | undefined;
      try {
        const u = new URL(localGitUrl);
        const segs = u.pathname.split('/').filter(Boolean);
        const baseName = segs.length ? segs[segs.length - 1].replace(/\.git$/i, '') : undefined;
        const branchTrimmed = localGitBranch.trim();
        if (baseName && branchTrimmed) {
          const branchSuffix = branchTrimmed.replace(/[^a-zA-Z0-9_\-]/g, '_');
          repoName = `${baseName}_${branchSuffix}`;
        } else {
          repoName = baseName;
        }
      } catch {
        repoName = undefined;
      }

      setCloneProgress({ phase: 'connecting', percent: 95 });
      const result = await connectToServer(
        proxyTrimmed,
        (phase, downloaded, total) => setCloneProgress({ phase, percent: 95 + (downloaded / (total || 1)) * 5 }),
        aborter.signal,
        repoName
      );
      if (onServerConnect) {
        onServerConnect(result, proxyTrimmed);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('Clone-analyze failed:', err);
      const message = err instanceof Error ? err.message : '克隆或分析失败';
      if (message.includes('401') || message.includes('403') || message.includes('Authentication')) {
        if (!localGitToken) {
          setError('该仓库需要鉴权，请填写访问令牌（Token）');
        } else {
          setError('鉴权失败，请检查令牌是否有效且具有仓库访问权限');
        }
      } else if (message.includes('404') || message.includes('not found')) {
        setError('仓库不存在或无权访问，请检查 URL 或填写正确令牌');
      } else {
        setError(message);
      }
    } finally {
      setIsCloning(false);
    }
  };

  const handleServerConnect = async () => {
    const urlToUse = serverUrl.trim() || window.location.origin;
    if (!urlToUse) {
      setError('Please enter a server URL');
      return;
    }

    // Persist URL to localStorage
    localStorage.setItem('gitnexus-server-url', serverUrl);

    setError(null);
    setIsConnecting(true);
    setServerProgress({ phase: 'validating', downloaded: 0, total: null });

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const repoToUse = serverRepoName.trim() || undefined;
    try {
      const result = await connectToServer(
        urlToUse,
        (phase, downloaded, total) => {
          setServerProgress({ phase, downloaded, total });
        },
        abortController.signal,
        repoToUse
      );

      if (repoToUse) {
        localStorage.setItem('gitnexus-server-repo', repoToUse);
      }
      if (onServerConnect) {
        onServerConnect(result, urlToUse);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // User cancelled
        return;
      }
      console.error('Server connect failed:', err);
      const message = err instanceof Error ? err.message : 'Failed to connect to server';
      if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
        setError('Cannot reach server. Check the URL and ensure the server is running.');
      } else {
        setError(message);
      }
    } finally {
      setIsConnecting(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancelConnect = () => {
    abortControllerRef.current?.abort();
    setIsConnecting(false);
  };

  const serverProgressPercent = serverProgress.total
    ? Math.round((serverProgress.downloaded / serverProgress.total) * 100)
    : null;

  return (
    <div className="flex items-center justify-center min-h-screen p-8 bg-void">
      {/* Background gradient effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-node-interface/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-lg">
        {/* Tab Switcher */}
        <div className="flex mb-4 bg-surface border border-border-default rounded-xl p-1">
          <button
            onClick={() => { setActiveTab('zip'); setError(null); }}
            className={`
              flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg
              text-sm font-medium transition-all duration-200
              ${activeTab === 'zip'
                ? 'bg-accent text-white shadow-md'
                : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
              }
            `}
          >
            <FileArchive className="w-4 h-4" />
            ZIP Upload
          </button>
          <button
            onClick={() => { setActiveTab('github'); setError(null); }}
            className={`
              flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg
              text-sm font-medium transition-all duration-200
              ${activeTab === 'github'
                ? 'bg-accent text-white shadow-md'
                : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
              }
            `}
          >
            <Github className="w-4 h-4" />
            GitHub
          </button>
          <button
            onClick={() => { setActiveTab('localgit'); setError(null); }}
            className={`
              flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg
              text-sm font-medium transition-all duration-200
              ${activeTab === 'localgit'
                ? 'bg-accent text-white shadow-md'
                : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
              }
            `}
          >
            <GitBranch className="w-4 h-4" />
            Local Git
          </button>
          <button
            onClick={() => { setActiveTab('server'); setError(null); }}
            className={`
              flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg
              text-sm font-medium transition-all duration-200
              ${activeTab === 'server'
                ? 'bg-accent text-white shadow-md'
                : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
              }
            `}
          >
            <Globe className="w-4 h-4" />
            Server
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        {/* ZIP Upload Tab */}
        {activeTab === 'zip' && (
          <>
            {/* 后端代理地址（可选）：填写后上传到后端解压分析，代码落在服务端 */}
            {onZipUploadToServer && (
              <div className="mb-4">
                <input
                  type="url"
                  name="zip-proxy-input"
                  value={zipProxyUrl}
                  onChange={(e) => setZipProxyUrl(e.target.value)}
                  placeholder="后端代理地址（可选）如 http://10.128.128.88:6660，填写后上传到后端解压分析"
                  disabled={isZipUploading}
                  className="
                    w-full px-4 py-2.5
                    bg-elevated border border-border-default rounded-xl
                    text-text-primary placeholder-text-muted text-sm
                    focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-all duration-200
                  "
                />
              </div>
            )}
            <div
              className={`
                relative p-16
                bg-surface border-2 border-dashed rounded-3xl
                transition-all duration-300 cursor-pointer
                ${isDragging
                  ? 'border-accent bg-elevated scale-105 shadow-glow'
                  : 'border-border-default hover:border-accent/50 hover:bg-elevated/50 animate-breathe'
                }
                ${isZipUploading ? 'pointer-events-none opacity-70' : ''}
              `}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !isZipUploading && document.getElementById('file-input')?.click()}
            >
              <input
                id="file-input"
                type="file"
                accept=".zip"
                className="hidden"
                onChange={handleFileInput}
              />

              {/* Icon */}
              <div className={`
                mx-auto w-20 h-20 mb-6
                flex items-center justify-center
                bg-gradient-to-br from-accent to-node-interface
                rounded-2xl shadow-glow
                transition-transform duration-300
                ${isDragging ? 'scale-110' : ''}
              `}>
                {isDragging ? (
                  <Upload className="w-10 h-10 text-white" />
                ) : isZipUploading ? (
                  <Loader2 className="w-10 h-10 text-white animate-spin" />
                ) : (
                  <FileArchive className="w-10 h-10 text-white" />
                )}
              </div>

              {/* Text */}
              <h2 className="text-xl font-semibold text-text-primary text-center mb-2">
                {isDragging ? 'Drop it here!' : isZipUploading ? '上传并分析中…' : 'Drop your codebase'}
              </h2>
              <p className="text-sm text-text-secondary text-center mb-6">
                {zipProxyUrl.trim()
                  ? '填写了代理地址：将上传到后端解压分析，代码落在服务端'
                  : 'Drag & drop a .zip file to generate a knowledge graph'}
              </p>

              {/* Hints */}
              <div className="flex items-center justify-center gap-3 text-xs text-text-muted">
                <span className="px-3 py-1.5 bg-elevated border border-border-subtle rounded-md">
                  .zip
                </span>
                {zipProxyUrl.trim() && (
                  <span className="px-3 py-1.5 bg-elevated border border-border-subtle rounded-md">
                    后端处理
                  </span>
                )}
              </div>
            </div>
            {isZipUploading && (
              <div className="mt-4 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-accent" />
              </div>
            )}
          </>
        )}

        {/* GitHub URL Tab */}
        {activeTab === 'github' && (
          <div className="p-8 bg-surface border border-border-default rounded-3xl">
            {/* Icon */}
            <div className="mx-auto w-20 h-20 mb-6 flex items-center justify-center bg-gradient-to-br from-[#333] to-[#24292e] rounded-2xl shadow-lg">
              <Github className="w-10 h-10 text-white" />
            </div>

            {/* Text */}
            <h2 className="text-xl font-semibold text-text-primary text-center mb-2">
              Clone from GitHub
            </h2>
            <p className="text-sm text-text-secondary text-center mb-6">
              Enter a repository URL to clone directly
            </p>

            {/* Inputs - wrapped in div to prevent form autofill */}
            <div className="space-y-3" data-form-type="other">
              <input
                type="url"
                name="github-repo-url-input"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isCloning && handleGitClone()}
                placeholder="https://github.com/owner/repo"
                disabled={isCloning}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                className="
                  w-full px-4 py-3
                  bg-elevated border border-border-default rounded-xl
                  text-text-primary placeholder-text-muted
                  focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all duration-200
                "
              />

              {/* Token input for private repos */}
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
                  <Key className="w-4 h-4" />
                </div>
                <input
                  type={showToken ? 'text' : 'password'}
                  name="github-pat-token-input"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="GitHub PAT (optional, for private repos)"
                  disabled={isCloning}
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  className="
                    w-full pl-10 pr-10 py-3
                    bg-elevated border border-border-default rounded-xl
                    text-text-primary placeholder-text-muted
                    focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-all duration-200
                  "
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <button
                onClick={handleGitClone}
                disabled={isCloning || !githubUrl.trim()}
                className="
                  w-full flex items-center justify-center gap-2
                  px-4 py-3
                  bg-accent hover:bg-accent/90
                  text-white font-medium rounded-xl
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all duration-200
                "
              >
                {isCloning ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {cloneProgress.phase === 'cloning'
                      ? `Cloning... ${cloneProgress.percent.toFixed(1)}%`
                      : cloneProgress.phase === 'reading'
                        ? 'Reading files...'
                        : 'Starting...'
                    }
                  </>
                ) : (
                  <>
                    Clone Repository
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </div>

            {/* Progress bar */}
            {isCloning && (
              <div className="mt-4">
                <div className="h-2 bg-elevated rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-300 ease-out"
                    style={{ width: `${cloneProgress.percent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Security note */}
            {githubToken && (
              <p className="mt-3 text-xs text-text-muted text-center">
                Token stays in your browser only, never sent to any server
              </p>
            )}

            {/* Hints */}
            <div className="mt-4 flex items-center justify-center gap-3 text-xs text-text-muted">
              <span className="px-3 py-1.5 bg-elevated border border-border-subtle rounded-md">
                {githubToken ? 'Private + Public' : 'Public repos'}
              </span>
              <span className="px-3 py-1.5 bg-elevated border border-border-subtle rounded-md">
                Shallow clone
              </span>
            </div>
          </div>
        )}

        {/* Local Git URL Tab */}
        {activeTab === 'localgit' && (
          <div className="p-8 bg-surface border border-border-default rounded-3xl">
            <div className="mx-auto w-20 h-20 mb-6 flex items-center justify-center bg-gradient-to-br from-emerald-600 to-accent rounded-2xl shadow-lg">
              <GitBranch className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-text-primary text-center mb-2">
              本地 / 私有 Git 仓库
            </h2>
            <p className="text-sm text-text-secondary text-center mb-6">
              填写服务地址（gitnexus serve）与 Git 仓库 URL、令牌；由服务端执行 clone-analyze，代码落在服务端 ginexus_code 目录。
            </p>

            <div className="space-y-3" data-form-type="other">
              <input
                type="url"
                name="local-git-proxy-input"
                value={localGitProxyUrl}
                onChange={(e) => setLocalGitProxyUrl(e.target.value)}
                placeholder="代理地址（可选，私有/内网必填）如 http://10.128.128.88:6660 或 gitnexus serve 地址"
                disabled={isCloning}
                autoComplete="off"
                data-form-type="other"
                className="
                  w-full px-4 py-3
                  bg-elevated border border-border-default rounded-xl
                  text-text-primary placeholder-text-muted
                  focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all duration-200
                "
              />
              <input
                type="url"
                name="local-git-url-input"
                value={localGitUrl}
                onChange={(e) => setLocalGitUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isCloning && handleLocalGitClone()}
                placeholder="Git 仓库 URL，如 https://git.example.com/org/repo.git"
                disabled={isCloning}
                autoComplete="off"
                data-lpignore="true"
                data-form-type="other"
                className="
                  w-full px-4 py-3
                  bg-elevated border border-border-default rounded-xl
                  text-text-primary placeholder-text-muted
                  focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all duration-200
                "
              />

              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
                  <GitBranch className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  name="local-git-branch-input"
                  value={localGitBranch}
                  onChange={(e) => setLocalGitBranch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !isCloning && handleLocalGitClone()}
                  placeholder="分支名（可选，不填则使用默认分支）"
                  disabled={isCloning}
                  autoComplete="off"
                  data-lpignore="true"
                  data-form-type="other"
                  className="
                    w-full pl-10 pr-4 py-3
                    bg-elevated border border-border-default rounded-xl
                    text-text-primary placeholder-text-muted
                    focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-all duration-200
                  "
                />
              </div>

              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
                  <Key className="w-4 h-4" />
                </div>
                <input
                  type={showLocalToken ? 'text' : 'password'}
                  name="local-git-token-input"
                  value={localGitToken}
                  onChange={(e) => setLocalGitToken(e.target.value)}
                  placeholder="访问令牌（必填，研发云仓库->应用菜单申请，经代理转发）"
                  disabled={isCloning}
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-form-type="other"
                  className="
                    w-full pl-10 pr-10 py-3
                    bg-elevated border border-border-default rounded-xl
                    text-text-primary placeholder-text-muted
                    focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-all duration-200
                  "
                />
                <button
                  type="button"
                  onClick={() => setShowLocalToken(!showLocalToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                >
                  {showLocalToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <button
                onClick={handleLocalGitClone}
                disabled={isCloning || !localGitUrl.trim() || !localGitProxyUrl.trim()}
                className="
                  w-full flex items-center justify-center gap-2
                  px-4 py-3
                  bg-accent hover:bg-accent/90
                  text-white font-medium rounded-xl
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all duration-200
                "
              >
                {isCloning ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {(() => {
                      const phase = cloneProgress.phase;
                      // 阶段映射：按优先级从高到低匹配
                      if (phase === 'already_exists') {
                        return '仓库已存在，正在连接…';
                      }
                      // Clone 阶段
                      if (phase === 'cloning') {
                        return `正在克隆... ${cloneProgress.percent.toFixed(1)}%`;
                      }
                      // UTF-8 转换阶段（克隆完成后）
                      if (phase === 'converting') {
                        return `正在转换编码... ${cloneProgress.percent.toFixed(1)}%`;
                      }
                      // 分析完成，正在连接服务器拉取图数据
                      if (phase === 'Analysis complete' || phase === 'connecting' || phase === 'validating' || phase === 'downloading' || phase === 'extracting') {
                        return `正在连接服务器... ${cloneProgress.percent.toFixed(1)}%`;
                      }
                      // 向量相关阶段（优先级高于通用分析阶段）
                      if (phase === 'Loading embedding model...' || phase === 'loading-model') {
                        return `正在加载向量模型... ${cloneProgress.percent.toFixed(1)}%`;
                      }
                      if (phase.startsWith('Embedding')) {
                        const match = phase.match(/Embedding\s+(\d+)\/(\d+)/);
                        if (match) {
                          const [, processed, total] = match;
                          return `正在生成向量... ${processed}/${total} 个节点 (${cloneProgress.percent.toFixed(1)}%)`;
                        }
                        return `正在生成向量... ${cloneProgress.percent.toFixed(1)}%`;
                      }
                      // 数据库加载阶段
                      if (phase === 'Loading into LadybugDB...' || phase.includes('LadybugDB')) {
                        return `正在加载到数据库... ${cloneProgress.percent.toFixed(1)}%`;
                      }
                      // 索引创建阶段
                      if (phase === 'Creating search indexes...' || phase.includes('search indexes')) {
                        return `正在创建搜索索引... ${cloneProgress.percent.toFixed(1)}%`;
                      }
                      // 恢复缓存向量阶段
                      if (phase.includes('Restoring') && phase.includes('cached embeddings')) {
                        return `正在恢复缓存的向量... ${cloneProgress.percent.toFixed(1)}%`;
                      }
                      // 保存元数据阶段
                      if (phase === 'Saving metadata...') {
                        return `正在保存元数据... ${cloneProgress.percent.toFixed(1)}%`;
                      }
                      // 生成技能文件阶段
                      if (phase.includes('Generating skill files')) {
                        return `正在生成技能文件... ${cloneProgress.percent.toFixed(1)}%`;
                      }
                      // 缓存向量阶段
                      if (phase === 'Caching embeddings...') {
                        return `正在缓存向量... ${cloneProgress.percent.toFixed(1)}%`;
                      }
                      // 通用分析阶段（pipeline 相关）
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
                        if (cloneProgress.filesProcessed !== undefined && cloneProgress.totalFiles) {
                          return `正在分析代码... ${cloneProgress.filesProcessed}/${cloneProgress.totalFiles} 个文件 (${cloneProgress.percent.toFixed(1)}%)`;
                        }
                        return `正在分析代码... ${cloneProgress.percent.toFixed(1)}%`;
                      }
                      // 默认显示
                      return `分析中... ${cloneProgress.percent.toFixed(1)}%`;
                    })()}
                  </>
                ) : (
                  <>
                    克隆并分析（代码落在服务端）
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </div>

            {isCloning && (
              <div className="mt-4">
                <div className="h-2 bg-elevated rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-300 ease-out"
                    style={{
                      width: `${
                        cloneProgress.filesProcessed !== undefined && cloneProgress.totalFiles
                          ? Math.max(
                              cloneProgress.percent,
                              // 文件进度映射到总进度 5-50% 区间，让进度条在 pipeline 阶段平滑推进
                              5 + Math.round((cloneProgress.filesProcessed / cloneProgress.totalFiles) * 45)
                            )
                          : cloneProgress.percent
                      }%`
                    }}
                  />
                </div>
                {cloneProgress.filesProcessed !== undefined && cloneProgress.totalFiles ? (
                  <p className="mt-1 text-xs text-text-muted text-center">
                    {cloneProgress.filesProcessed} / {cloneProgress.totalFiles} 个文件
                  </p>
                ) : null}
              </div>
            )}

            {localGitToken && (
              <p className="mt-3 text-xs text-text-muted text-center">
                令牌仅保存在当前页面，不会上传到任何服务器
              </p>
            )}

            <div className="mt-4 flex items-center justify-center gap-3 text-xs text-text-muted">
              <span className="px-3 py-1.5 bg-elevated border border-border-subtle rounded-md">
                HTTPS
              </span>
              <span className="px-3 py-1.5 bg-elevated border border-border-subtle rounded-md">
                支持鉴权
              </span>
            </div>
          </div>
        )}

        {/* Server Tab */}
        {activeTab === 'server' && (
          <div className="p-8 bg-surface border border-border-default rounded-3xl">
            {/* Icon */}
            <div className="mx-auto w-20 h-20 mb-6 flex items-center justify-center bg-gradient-to-br from-accent to-emerald-600 rounded-2xl shadow-lg">
              <Globe className="w-10 h-10 text-white" />
            </div>

            {/* Text */}
            <h2 className="text-xl font-semibold text-text-primary text-center mb-2">
              Connect to Server
            </h2>
            <p className="text-sm text-text-secondary text-center mb-6">
              Load a pre-built knowledge graph from a running GitNexus server
            </p>

            {/* Inputs */}
            <div className="space-y-3" data-form-type="other">
              <input
                type="url"
                name="server-url-input"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isConnecting && handleServerConnect()}
                placeholder={typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:6660` : 'http://localhost:6660'}
                disabled={isConnecting}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                className="
                  w-full px-4 py-3
                  bg-elevated border border-border-default rounded-xl
                  text-text-primary placeholder-text-muted
                  focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all duration-200
                "
              />

              <input
                type="text"
                name="server-repo-input"
                value={serverRepoName}
                onChange={(e) => setServerRepoName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isConnecting && handleServerConnect()}
                placeholder="仓库名称（可选，多仓库时指定）"
                disabled={isConnecting}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                className="
                  w-full px-4 py-3
                  bg-elevated border border-border-default rounded-xl
                  text-text-primary placeholder-text-muted
                  focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all duration-200
                "
              />

              <div className="flex gap-2">
                <button
                  onClick={handleServerConnect}
                  disabled={isConnecting}
                  className="
                    flex-1 flex items-center justify-center gap-2
                    px-4 py-3
                    bg-accent hover:bg-accent/90
                    text-white font-medium rounded-xl
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-all duration-200
                  "
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {serverProgress.phase === 'validating'
                        ? 'Validating...'
                        : serverProgress.phase === 'downloading'
                          ? serverProgressPercent !== null
                            ? `Downloading... ${serverProgressPercent}%`
                            : `Downloading... ${formatBytes(serverProgress.downloaded)}`
                          : serverProgress.phase === 'extracting'
                            ? 'Processing...'
                            : 'Connecting...'
                      }
                    </>
                  ) : (
                    <>
                      Connect
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>

                {isConnecting && (
                  <button
                    onClick={handleCancelConnect}
                    className="
                      flex items-center justify-center
                      px-4 py-3
                      bg-red-500/20 hover:bg-red-500/30
                      text-red-400 font-medium rounded-xl
                      transition-all duration-200
                    "
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>

            {/* Progress bar */}
            {isConnecting && serverProgress.phase === 'downloading' && (
              <div className="mt-4">
                <div className="h-2 bg-elevated rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-accent transition-all duration-300 ease-out ${
                      serverProgressPercent === null ? 'animate-pulse' : ''
                    }`}
                    style={{
                      width: serverProgressPercent !== null
                        ? `${serverProgressPercent}%`
                        : '100%',
                    }}
                  />
                </div>
                {serverProgress.total && (
                  <p className="mt-1 text-xs text-text-muted text-center">
                    {formatBytes(serverProgress.downloaded)} / {formatBytes(serverProgress.total)}
                  </p>
                )}
              </div>
            )}

            {/* Hints */}
            <div className="mt-4 flex items-center justify-center gap-3 text-xs text-text-muted">
              <span className="px-3 py-1.5 bg-elevated border border-border-subtle rounded-md">
                Pre-indexed
              </span>
              <span className="px-3 py-1.5 bg-elevated border border-border-subtle rounded-md">
                No WASM needed
              </span>
            </div>

            {/* 本地/私有 Git 接入说明 */}
            <div className="mt-6 p-4 bg-elevated/60 border border-border-subtle rounded-xl text-sm text-text-secondary">
              <p className="font-medium text-text-primary mb-1">添加本地或私有仓库</p>
              <p className="mb-2">
                在运行 GitNexus 的机器上，对已克隆的本地/私有仓库执行：
              </p>
              <code className="block px-3 py-2 bg-surface rounded-lg text-accent font-mono text-xs break-all">
                gitnexus add /path/to/your/repo
              </code>
              <p className="mt-2 text-xs text-text-muted">
                或使用 <code className="px-1 py-0.5 bg-surface rounded">gitnexus analyze /path/to/repo</code>。完成后刷新上方连接或重新选择仓库即可在列表中看到新仓库。
              </p>
              <p className="mt-3 text-xs text-text-muted border-t border-border-subtle pt-3">
                <span className="font-medium text-text-secondary">需鉴权（令牌）时：</span>请先在服务器上使用令牌克隆仓库，再对克隆目录执行上述命令。例如：
              </p>
              <code className="block mt-1 px-3 py-2 bg-surface rounded-lg text-accent font-mono text-xs break-all">
                git clone https://&lt;您的令牌&gt;@git.example.com/org/repo.git /path/to/repo
              </code>
              <p className="mt-1 text-xs text-text-muted">
                或将令牌配置到 Git 凭据（如 <code className="px-1 py-0.5 bg-surface rounded">git config credential.helper</code>）后执行 <code className="px-1 py-0.5 bg-surface rounded">git clone</code>，再运行 <code className="px-1 py-0.5 bg-surface rounded">gitnexus add /path/to/repo</code>。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
