import { useCallback, useEffect, useRef } from 'react';
import { AppStateProvider, useAppState } from './hooks/useAppState';
import { DropZone } from './components/DropZone';
import { LoadingOverlay } from './components/LoadingOverlay';
import { Header } from './components/Header';
import { GraphCanvas, GraphCanvasHandle } from './components/GraphCanvas';
import { RightPanel } from './components/RightPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { StatusBar } from './components/StatusBar';
import { FileTreePanel } from './components/FileTreePanel';
import { CodeReferencesPanel } from './components/CodeReferencesPanel';
import { FileEntry } from './services/zip';
import { getActiveProviderConfig } from './core/llm/settings-service';
import { createKnowledgeGraph } from './core/graph/graph';
import { connectToServer, fetchRepos, normalizeServerUrl, uploadZipAnalyzeOnServer, type ConnectToServerResult } from './services/server-connection';

const AppContent = () => {
  const {
    viewMode,
    setViewMode,
    setGraph,
    setFileContents,
    setProgress,
    setProjectName,
    progress,
    isRightPanelOpen,
    runPipeline,
    runPipelineFromFiles,
    isSettingsPanelOpen,
    setSettingsPanelOpen,
    refreshLLMSettings,
    initializeAgent,
    initializeBackendAgent,
    startEmbeddings,
    setEmbeddingError,
    embeddingStatus,
    codeReferences,
    selectedNode,
    isCodePanelOpen,
    serverBaseUrl,
    setServerBaseUrl,
    serverRepoName,
    setServerRepoName,
    projectName,
    availableRepos,
    setAvailableRepos,
    switchRepo,
  } = useAppState();

  const graphCanvasRef = useRef<GraphCanvasHandle>(null);

  const handleFileSelect = useCallback(async (file: File) => {
    const projectName = file.name.replace('.zip', '');
    setProjectName(projectName);
    setProgress({ phase: 'extracting', percent: 0, message: 'Starting...', detail: 'Preparing to extract files' });
    setViewMode('loading');

    try {
      const result = await runPipeline(file, (progress) => {
        setProgress(progress);
      });

      setGraph(result.graph);
      setFileContents(result.fileContents);
      setViewMode('exploring');

      // Initialize (or re-initialize) the agent AFTER a repo loads so it captures
      // the current codebase context (file contents + graph tools) in the worker.
      if (getActiveProviderConfig()) {
        initializeAgent(projectName);
      }

      // Auto-start embeddings pipeline in background when KuzuDB loaded (required for vector search)
      if (result.kuzuReady !== false) {
        startEmbeddings().catch((err) => {
          if (err?.name === 'WebGPUNotAvailableError' || err?.message?.includes('WebGPU')) {
            startEmbeddings('wasm').catch(console.warn);
          } else {
            console.warn('Embeddings auto-start failed:', err);
          }
        });
      } else {
        setEmbeddingError(
          '向量检索不可用：内存数据库加载失败（常见原因：跨域或未开启 SharedArrayBuffer）。关键词检索与图谱仍可用。'
        );
      }
    } catch (error) {
      console.error('Pipeline error:', error);
      setProgress({
        phase: 'error',
        percent: 0,
        message: 'Error processing file',
        detail: error instanceof Error ? error.message : 'Unknown error',
      });
      setTimeout(() => {
        setViewMode('onboarding');
        setProgress(null);
      }, 3000);
    }
  }, [setViewMode, setGraph, setFileContents, setProgress, setProjectName, runPipeline, startEmbeddings, setEmbeddingError, initializeAgent]);

  const handleGitClone = useCallback(async (files: FileEntry[]) => {
    const firstPath = files[0]?.path || 'repository';
    const projectName = firstPath.split('/')[0].replace(/-\d+$/, '') || 'repository';

    setProjectName(projectName);
    setProgress({ phase: 'extracting', percent: 0, message: 'Starting...', detail: 'Preparing to process files' });
    setViewMode('loading');

    try {
      const result = await runPipelineFromFiles(files, (progress) => {
        setProgress(progress);
      });

      setGraph(result.graph);
      setFileContents(result.fileContents);
      setViewMode('exploring');

      if (getActiveProviderConfig()) {
        initializeAgent(projectName);
      }

      if (result.kuzuReady !== false) {
        startEmbeddings().catch((err) => {
          if (err?.name === 'WebGPUNotAvailableError' || err?.message?.includes('WebGPU')) {
            startEmbeddings('wasm').catch(console.warn);
          } else {
            console.warn('Embeddings auto-start failed:', err);
          }
        });
      } else {
        setEmbeddingError(
          '向量检索不可用：内存数据库加载失败（常见原因：跨域或未开启 SharedArrayBuffer）。关键词检索与图谱仍可用。'
        );
      }
    } catch (error) {
      console.error('Pipeline error:', error);
      setProgress({
        phase: 'error',
        percent: 0,
        message: 'Error processing repository',
        detail: error instanceof Error ? error.message : 'Unknown error',
      });
      setTimeout(() => {
        setViewMode('onboarding');
        setProgress(null);
      }, 3000);
    }
  }, [setViewMode, setGraph, setFileContents, setProgress, setProjectName, runPipelineFromFiles, startEmbeddings, setEmbeddingError, initializeAgent]);

  const handleServerConnect = useCallback((
    result: ConnectToServerResult,
    baseUrl?: string,
    repoName?: string,
  ) => {
    // Extract project name from repoPath
    const repoPath = result.repoInfo.repoPath;
    const projectName = result.repoInfo.name || repoPath.split('/').pop() || 'server-project';
    setProjectName(projectName);

    // Store repo name for server mode queries
    const effectiveRepoName = repoName || result.repoInfo.name || projectName;
    setServerRepoName(effectiveRepoName);

    // Build KnowledgeGraph from server data (bypasses WASM pipeline entirely)
    const graph = createKnowledgeGraph();
    for (const node of result.nodes) {
      graph.addNode(node);
    }
    for (const rel of result.relationships) {
      graph.addRelationship(rel);
    }
    setGraph(graph);

    // Set file contents from extracted File node content
    const fileMap = new Map<string, string>();
    for (const [path, content] of Object.entries(result.fileContents)) {
      fileMap.set(path, content);
    }
    setFileContents(fileMap);

    // Transition directly to exploring view
    setViewMode('exploring');

    // Initialize backend agent if LLM is configured
    // Pass fileMap directly to avoid stale closure (setFileContents is async)
    if (getActiveProviderConfig() && baseUrl) {
      initializeBackendAgent(baseUrl, effectiveRepoName, projectName, fileMap);
    } else if (getActiveProviderConfig()) {
      // Fallback: try local agent (will fail gracefully if KuzuDB not loaded)
      initializeAgent(projectName);
    }

    // Auto-start embeddings
    startEmbeddings().catch((err) => {
      if (err?.name === 'WebGPUNotAvailableError' || err?.message?.includes('WebGPU')) {
        startEmbeddings('wasm').catch(console.warn);
      } else {
        console.warn('Embeddings auto-start failed:', err);
      }
    });
  }, [setViewMode, setGraph, setFileContents, setProjectName, setServerRepoName, initializeAgent, initializeBackendAgent, startEmbeddings]);

  const handleZipUploadToServer = useCallback(
    async (file: File, proxyUrl: string) => {
      const baseName = file.name.replace(/\.zip$/i, '');
      const repoName = `${baseName}_zip`;
      setProjectName(repoName);
      setProgress({ phase: 'extracting', percent: 0, message: 'Checking server...', detail: 'Validating' });
      setViewMode('loading');

      const baseUrl = normalizeServerUrl(proxyUrl);
      const aborter = new AbortController();

      try {
        // 持久化：通过压缩包名称判断是否已上传，已上传则直接走 server 模式
        const repos = await fetchRepos(baseUrl);
        const repoExists = repos.some((r) => r.name === repoName);
        if (repoExists) {
          setProgress({ phase: 'extracting', percent: 10, message: '已上传过，正在连接...', detail: repoName });
          const result = await connectToServer(
            proxyUrl,
            (phase, downloaded, total) => {
              if (phase === 'validating') {
                setProgress({ phase: 'extracting', percent: 15, message: 'Connecting...', detail: 'Validating' });
              } else if (phase === 'downloading') {
                const pct = total ? Math.round((downloaded / total) * 90) + 15 : 50;
                setProgress({ phase: 'extracting', percent: pct, message: 'Downloading graph...', detail: `${(downloaded / (1024 * 1024)).toFixed(1)} MB` });
              } else if (phase === 'extracting') {
                setProgress({ phase: 'extracting', percent: 97, message: 'Processing...', detail: 'Extracting' });
              }
            },
            aborter.signal,
            repoName
          );
          setServerBaseUrl(baseUrl);
          setServerRepoName(repoName);
          handleServerConnect(result, baseUrl, repoName);
          try {
            const allRepos = await fetchRepos(baseUrl);
            setAvailableRepos(allRepos);
          } catch (e) {
            console.warn('Failed to fetch repo list:', e);
          }
          return;
        }

        setProgress({ phase: 'extracting', percent: 5, message: 'Uploading ZIP...', detail: file.name });
        await uploadZipAnalyzeOnServer(
          proxyUrl,
          file,
          (phase, percent) => {
            const msg = phase === 'already_exists' ? '已存在，正在连接...' : phase === 'extract_done' ? '解压完成，分析中...' : phase;
            setProgress({ phase: 'extracting', percent: 5 + percent * 0.9, message: msg, detail: `${percent}%` });
          },
          aborter.signal
        );

        setProgress({ phase: 'extracting', percent: 95, message: 'Connecting...', detail: 'Fetching graph' });
        const result = await connectToServer(
          proxyUrl,
          (phase, downloaded, total) => {
            if (phase === 'validating') {
              setProgress({ phase: 'extracting', percent: 95, message: 'Connecting...', detail: 'Validating' });
            } else if (phase === 'downloading') {
              const pct = total ? 95 + (downloaded / total) * 5 : 97;
              setProgress({ phase: 'extracting', percent: pct, message: 'Downloading graph...', detail: `${(downloaded / (1024 * 1024)).toFixed(1)} MB` });
            } else if (phase === 'extracting') {
              setProgress({ phase: 'extracting', percent: 99, message: 'Processing...', detail: 'Extracting' });
            }
          },
          aborter.signal,
          repoName
        );

        setServerBaseUrl(baseUrl);
        setServerRepoName(repoName);
        handleServerConnect(result, baseUrl, repoName);

        try {
          const allRepos = await fetchRepos(baseUrl);
          setAvailableRepos(allRepos);
        } catch (e) {
          console.warn('Failed to fetch repo list:', e);
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        console.error('ZIP upload to server failed:', error);
        setProgress({
          phase: 'error',
          percent: 0,
          message: 'ZIP 上传或分析失败',
          detail: error instanceof Error ? error.message : 'Unknown error',
        });
        setTimeout(() => {
          setViewMode('onboarding');
          setProgress(null);
        }, 3000);
      }
    },
    [handleServerConnect, setViewMode, setProgress, setProjectName, setServerBaseUrl, setServerRepoName, setAvailableRepos]
  );

  // 默认 server 访问模式：URL 参数 server（必填）、repo（可选）指定服务地址与仓库，自动连接并保留参数便于刷新/书签
  const autoConnectRan = useRef(false);
  useEffect(() => {
    if (autoConnectRan.current) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('server')) return;
    autoConnectRan.current = true;

    setProgress({ phase: 'extracting', percent: 0, message: 'Connecting to server...', detail: 'Validating server' });
    setViewMode('loading');

    const serverUrl = params.get('server') || window.location.origin;
    const repoParam = params.get('repo') || undefined;

    const baseUrl = normalizeServerUrl(serverUrl);

    connectToServer(serverUrl, (phase, downloaded, total) => {
      if (phase === 'validating') {
        setProgress({ phase: 'extracting', percent: 5, message: 'Connecting to server...', detail: 'Validating server' });
      } else if (phase === 'downloading') {
        const pct = total ? Math.round((downloaded / total) * 90) + 5 : 50;
        const mb = (downloaded / (1024 * 1024)).toFixed(1);
        setProgress({ phase: 'extracting', percent: pct, message: 'Downloading graph...', detail: `${mb} MB downloaded` });
      } else if (phase === 'extracting') {
        setProgress({ phase: 'extracting', percent: 97, message: 'Processing...', detail: 'Extracting file contents' });
      }
    }, undefined, repoParam).then(async (result) => {
      // Store server URL first so handleServerConnect can use it
      setServerBaseUrl(baseUrl);
      handleServerConnect(result, baseUrl, repoParam);

      // Fetch available repos for the repo switcher
      try {
        const repos = await fetchRepos(baseUrl);
        setAvailableRepos(repos);
      } catch (e) {
        console.warn('Failed to fetch repo list:', e);
      }
    }).catch((err) => {
      console.error('Auto-connect failed:', err);
      setProgress({
        phase: 'error',
        percent: 0,
        message: 'Failed to connect to server',
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
      setTimeout(() => {
        setViewMode('onboarding');
        setProgress(null);
      }, 3000);
    });
  }, [handleServerConnect, setProgress, setViewMode, setServerBaseUrl, setAvailableRepos]);

  const handleFocusNode = useCallback((nodeId: string) => {
    graphCanvasRef.current?.focusNode(nodeId);
  }, []);

  // Handle settings saved - refresh and reinitialize agent
  // NOTE: Must be defined BEFORE any conditional returns (React hooks rule)
  const handleSettingsSaved = useCallback(() => {
    refreshLLMSettings();
    // server 模式下用 backend agent，本地模式用 local agent
    if (serverBaseUrl && serverRepoName) {
      initializeBackendAgent(serverBaseUrl, serverRepoName, projectName || serverRepoName);
    } else {
      initializeAgent(projectName || undefined);
    }
  }, [refreshLLMSettings, initializeAgent, initializeBackendAgent, serverBaseUrl, serverRepoName, projectName]);

  // Render based on view mode
  if (viewMode === 'onboarding') {
    return (
      <DropZone
        onFileSelect={handleFileSelect}
        onGitClone={handleGitClone}
        onZipUploadToServer={handleZipUploadToServer}
        onServerConnect={async (result, serverUrl) => {
          if (serverUrl) {
            const baseUrl = normalizeServerUrl(serverUrl);
            setServerBaseUrl(baseUrl);
            handleServerConnect(result, baseUrl, result.repoInfo.name);
            try {
              const repos = await fetchRepos(baseUrl);
              setAvailableRepos(repos);
            } catch (e) {
              console.warn('Failed to fetch repo list:', e);
            }
          } else {
            handleServerConnect(result);
          }
        }}
      />
    );
  }

  if (viewMode === 'loading' && progress) {
    return <LoadingOverlay progress={progress} />;
  }

  // Exploring view
  return (
    <div className="flex flex-col h-screen bg-void overflow-hidden">
      <Header onFocusNode={handleFocusNode} availableRepos={availableRepos} onSwitchRepo={switchRepo} />

      <main className="flex-1 flex min-h-0">
        {/* Left Panel - File Tree */}
        <FileTreePanel onFocusNode={handleFocusNode} />

        {/* Graph area - takes remaining space */}
        <div className="flex-1 relative min-w-0">
          <GraphCanvas ref={graphCanvasRef} />

          {/* Code References Panel (overlay) - does NOT resize the graph, it overlaps on top */}
          {isCodePanelOpen && (codeReferences.length > 0 || !!selectedNode) && (
            <div className="absolute inset-y-0 left-0 z-30 pointer-events-auto">
              <CodeReferencesPanel onFocusNode={handleFocusNode} />
            </div>
          )}
        </div>

        {/* Right Panel - Code & Chat (tabbed) */}
        {isRightPanelOpen && <RightPanel />}
      </main>

      <StatusBar />

      {/* Settings Panel (modal) */}
      <SettingsPanel
        isOpen={isSettingsPanelOpen}
        onClose={() => setSettingsPanelOpen(false)}
        onSettingsSaved={handleSettingsSaved}
      />

    </div>
  );
};

function App() {
  return (
    <AppStateProvider>
      <AppContent />
    </AppStateProvider>
  );
}

export default App;
