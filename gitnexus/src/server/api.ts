/**
 * HTTP API Server
 *
 * REST API for browser-based clients to query the local .gitnexus/ index.
 * Also hosts the MCP server over StreamableHTTP for remote AI tool access.
 *
 * Security: binds to 127.0.0.1 by default (use --host to override).
 * CORS is restricted to localhost and the deployed site.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import { spawnSync, spawn } from 'child_process';
import * as readline from 'readline';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { loadMeta, listRegisteredRepos, readRegistry } from '../storage/repo-manager.js';
import { executeQuery, closeKuzu, withKuzuDb } from '../core/kuzu/kuzu-adapter.js';
import { NODE_TABLES } from '../core/kuzu/schema.js';
import { GraphNode, GraphRelationship } from '../core/graph/types.js';
import { searchFTSFromKuzu } from '../core/search/bm25-index.js';
import { hybridSearch } from '../core/search/hybrid-search.js';
// Embedding imports are lazy (dynamic import) to avoid loading onnxruntime-node
// at server startup — crashes on unsupported Node ABI versions (#89)
import { LocalBackend } from '../mcp/local/local-backend.js';
import { mountMCPEndpoints } from './mcp-http.js';

const buildGraph = async (): Promise<{ nodes: GraphNode[]; relationships: GraphRelationship[] }> => {
  const nodes: GraphNode[] = [];
  for (const table of NODE_TABLES) {
    try {
      let query = '';
      if (table === 'File') {
        query = `MATCH (n:File) RETURN n.id AS id, n.name AS name, n.filePath AS filePath, n.content AS content`;
      } else if (table === 'Folder') {
        query = `MATCH (n:Folder) RETURN n.id AS id, n.name AS name, n.filePath AS filePath`;
      } else if (table === 'Community') {
        query = `MATCH (n:Community) RETURN n.id AS id, n.label AS label, n.heuristicLabel AS heuristicLabel, n.cohesion AS cohesion, n.symbolCount AS symbolCount`;
      } else if (table === 'Process') {
        query = `MATCH (n:Process) RETURN n.id AS id, n.label AS label, n.heuristicLabel AS heuristicLabel, n.processType AS processType, n.stepCount AS stepCount, n.communities AS communities, n.entryPointId AS entryPointId, n.terminalId AS terminalId`;
      } else if (table === 'Macro') {
        query = `MATCH (n:\`Macro\`) RETURN n.id AS id, n.name AS name, n.filePath AS filePath, n.startLine AS startLine, n.endLine AS endLine, n.content AS content`;
      } else {
        query = `MATCH (n:${table}) RETURN n.id AS id, n.name AS name, n.filePath AS filePath, n.startLine AS startLine, n.endLine AS endLine, n.content AS content`;
      }

      const rows = await executeQuery(query);
      for (const row of rows) {
        nodes.push({
          id: row.id ?? row[0],
          label: table as GraphNode['label'],
          properties: {
            name: row.name ?? row.label ?? row[1],
            filePath: row.filePath ?? row[2],
            startLine: row.startLine,
            endLine: row.endLine,
            content: row.content,
            heuristicLabel: row.heuristicLabel,
            cohesion: row.cohesion,
            symbolCount: row.symbolCount,
            processType: row.processType,
            stepCount: row.stepCount,
            communities: row.communities,
            entryPointId: row.entryPointId,
            terminalId: row.terminalId,
          } as GraphNode['properties'],
        });
      }
    } catch {
      // ignore empty tables
    }
  }

  const relationships: GraphRelationship[] = [];
  const relRows = await executeQuery(
    `MATCH (a)-[r:CodeRelation]->(b) RETURN a.id AS sourceId, b.id AS targetId, r.type AS type, r.confidence AS confidence, r.reason AS reason, r.step AS step`
  );
  for (const row of relRows) {
    relationships.push({
      id: `${row.sourceId}_${row.type}_${row.targetId}`,
      type: row.type,
      sourceId: row.sourceId,
      targetId: row.targetId,
      confidence: row.confidence,
      reason: row.reason,
      step: row.step,
    });
  }

  return { nodes, relationships };
};

const statusFromError = (err: any): number => {
  const msg = String(err?.message ?? '');
  if (msg.includes('No indexed repositories') || msg.includes('not found')) return 404;
  if (msg.includes('Multiple repositories')) return 400;
  return 500;
};

const requestedRepo = (req: express.Request): string | undefined => {
  const fromQuery = typeof req.query.repo === 'string' ? req.query.repo : undefined;
  if (fromQuery) return fromQuery;

  if (req.body && typeof req.body === 'object' && typeof req.body.repo === 'string') {
    return req.body.repo;
  }

  return undefined;
};

export const createServer = async (port: number, host: string = '127.0.0.1', opts?: { embeddings?: boolean }) => {
  const app = express();
  const enableEmbeddings = !!opts?.embeddings;

  // CORS: only allow localhost origins and the deployed site.
  // Non-browser requests (curl, server-to-server) have no origin and are allowed.
  app.use(cors({
    origin: (origin, callback) => {
      if (
        !origin
        || origin.startsWith('http://localhost:')
        || origin.startsWith('http://127.0.0.1:')
        || origin === 'https://gitnexus.vercel.app'
      ) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    }
  }));
  app.use(express.json({ limit: '10mb' }));

  // Initialize MCP backend (multi-repo, shared across all MCP sessions)
  const backend = new LocalBackend();
  await backend.init();
  const cleanupMcp = mountMCPEndpoints(app, backend);

  // Helper: resolve a repo by name from the global registry, or default to first
  const resolveRepo = async (repoName?: string) => {
    const repos = await listRegisteredRepos();
    if (repos.length === 0) return null;
    if (repoName) return repos.find(r => r.name === repoName) || null;
    return repos[0]; // default to first
  };

  // 一键下载并分析：代码目录 = HOME 或 启动路径，子目录 ginexus_code；已在 registry 则禁止重复下载
  const GINEXUS_CODE_DIR = 'ginexus_code';
  const getCodeBaseDir = (): string => process.env.HOME || process.cwd();
  const getCodeDir = (): string => path.join(getCodeBaseDir(), GINEXUS_CODE_DIR);

  const getRepoNameFromUrl = (url: string): string | null => {
    const trimmed = url.trim().replace(/\.git$/i, '');
    try {
      const u = new URL(trimmed);
      const segs = u.pathname.split('/').filter(Boolean);
      return segs.length ? segs[segs.length - 1] : null;
    } catch {
      return null;
    }
  };

  const pathEquals = (a: string, b: string): boolean => {
    const x = path.resolve(a);
    const y = path.resolve(b);
    return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
  };

  app.post('/api/repos/clone-analyze', async (req, res) => {
    try {
      const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
      const token = typeof req.body?.token === 'string' ? req.body.token.trim() : undefined;
      const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : undefined;
      if (!url) {
        res.status(400).json({ error: 'Missing url in body. Example: { "url": "https://host/org/repo.git", "token": "optional", "branch": "optional" }' });
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        res.status(400).json({ error: 'Invalid URL' });
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        res.status(400).json({ error: 'Only http/https URLs are allowed' });
        return;
      }
      const repoName = getRepoNameFromUrl(url);
      if (!repoName) {
        res.status(400).json({ error: 'Could not get repo name from URL' });
        return;
      }
      const codeDir = getCodeDir();
      // 若指定了分支，目录名加上分支后缀，避免同一仓库不同分支互相覆盖
      const dirSuffix = branch ? `_${branch.replace(/[^a-zA-Z0-9_\-]/g, '_')}` : '';
      const targetPath = path.resolve(codeDir, repoName + dirSuffix);

      const entries = await readRegistry();
      if (entries.some((e) => pathEquals(e.path, targetPath))) {
        res.json({ ok: true, alreadyExists: true, path: targetPath, message: 'Repo already in registry, skip clone' });
        return;
      }

      await fs.mkdir(codeDir, { recursive: true });

      const cloneUrl = token
        ? `${parsed.protocol}//${encodeURIComponent(token)}@${parsed.host}${parsed.pathname}${url.endsWith('.git') ? '' : '.git'}`
        : url.replace(/\.git$/i, '') + (url.match(/\.git$/i) ? '' : '.git');
      const cloneArgs = ['clone', '--depth', '1'];
      if (branch) {
        cloneArgs.push('--branch', branch, '--single-branch');
      }
      cloneArgs.push(cloneUrl, targetPath);
      console.log('[clone-analyze] clone start:', url, branch ? `(branch: ${branch})` : '(default branch)');
      const cloneResult = spawnSync('git', cloneArgs, {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      if (cloneResult.status !== 0) {
        const stderr = cloneResult.stderr || cloneResult.error?.message || '';
        console.error('[clone-analyze] git clone failed:', stderr);
        res.status(500).json({ error: 'Clone failed', details: stderr.slice(0, 500) });
        return;
      }
      console.log('[clone-analyze] clone done:', targetPath);

      const __dirnameServer = path.dirname(fileURLToPath(import.meta.url));
      const pkgRoot = path.resolve(__dirnameServer, '../..');
      const scriptCandidates = [
        path.resolve(pkgRoot, '..', 'convert_to_utf8.py'),
        path.join(pkgRoot, 'scripts', 'convert_to_utf8.py'),
      ];
      const convertScript = scriptCandidates.find((p) => existsSync(p));
      if (!convertScript) {
        console.warn('[clone-analyze] UTF-8 conversion skipped: convert_to_utf8.py not found. Tried:', scriptCandidates.join(', '));
      } else {
        const pyCandidates = process.platform === 'win32'
          ? ['python3', 'python', 'py']
          : ['python3', 'python'];
        let convertOk = false;
        for (const py of pyCandidates) {
          const convertResult = spawnSync(py, process.platform === 'win32' && py === 'py' ? ['-3', convertScript, targetPath] : [convertScript, targetPath], {
            stdio: 'pipe',
            encoding: 'utf-8',
            shell: false,
          });
          const errObj = convertResult.error as NodeJS.ErrnoException | undefined;
          if (errObj?.code === 'ENOENT') continue; // this python not in PATH
          if (convertResult.status === 0) {
            console.log('[clone-analyze] UTF-8 conversion done (via', py + ')');
            convertOk = true;
            break;
          }
          const err = (convertResult.stderr || convertResult.stdout || convertResult.error?.message || '').slice(0, 800);
          console.warn('[clone-analyze] UTF-8 conversion failed with', py, ':', convertResult.status, err);
        }
        if (!convertOk) {
          console.warn('[clone-analyze] GBK/other encodings were not converted to UTF-8. Install Python and ensure gitnexus/scripts/convert_to_utf8.py is available.');
        }
      }

      console.log('[clone-analyze] -> starting analyze');

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      const send = (data: object) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      send({ type: 'clone_done', path: targetPath });

      const cliPath = path.join(__dirnameServer, '../cli/index.js');
      const nodeOptions = (process.env.NODE_OPTIONS || '').trim();
      const analyzeEnv = {
        ...process.env,
        NODE_OPTIONS: nodeOptions ? `${nodeOptions} --max-old-space-size=8192` : '--max-old-space-size=8192',
        GITNEXUS_PROGRESS: '1',
      };
      const analyzeArgs = [cliPath, 'analyze', targetPath];
      if (enableEmbeddings) {
        analyzeArgs.push('--embeddings');
        console.log('[clone-analyze] embeddings enabled for this run');
      }
      const child = spawn(process.execPath, analyzeArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: pkgRoot,
        env: analyzeEnv,
      });
      const rl = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
      let doneSent = false;
      let lastPhase = '';
      let lastPercent = -1;
      const finishResponse = () => {
        if (doneSent) return;
        doneSent = true;
        res.end();
      };
      rl.on('line', (line) => {
        if (doneSent) return;
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const data = JSON.parse(trimmed);
          if (data.done) {
            send({ type: 'done', ok: true, path: data.path ?? targetPath });
            finishResponse();
          } else {
            const phase = data.phase ?? '';
            const percent = typeof data.percent === 'number' ? data.percent : 0;
            if (phase !== lastPhase || percent !== lastPercent) {
              lastPhase = phase;
              lastPercent = percent;
              send({ type: 'progress', phase, percent });
            }
          }
        } catch {
          if (trimmed !== lastPhase || 0 !== lastPercent) {
            lastPhase = trimmed;
            lastPercent = 0;
            send({ type: 'progress', phase: trimmed, percent: 0 });
          }
        }
      });
      child.stderr?.on('data', (chunk) => {
        const msg = chunk.toString();
        process.stderr.write('[clone-analyze] ' + msg);
      });
      child.on('close', (code) => {
        console.log('[clone-analyze] analyze exit code:', code, targetPath);
        rl.close();
        if (!doneSent) {
          if (code === 0) send({ type: 'done', ok: true, path: targetPath });
          else send({ type: 'done', ok: false, error: 'Analyze exited with code ' + code });
          finishResponse();
        }
      });
      child.on('error', (err) => {
        rl.close();
        send({ type: 'done', ok: false, error: err.message });
        res.end();
      });
    } catch (err: any) {
      console.error('[clone-analyze]', err);
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  // ZIP 上传并分析：接收 zip 文件，解压到 ginexus_code/{zip名}，执行 analyze（参考 clone-analyze）
  app.post(
    '/api/repos/zip-upload-analyze',
    express.raw({ type: '*/*', limit: '500mb' }),
    async (req, res) => {
      try {
        const zipName = (typeof req.headers['x-zip-name'] === 'string' ? req.headers['x-zip-name'] : '').trim();
        if (!zipName || !/\.zip$/i.test(zipName)) {
          res.status(400).json({ error: 'Missing or invalid X-Zip-Name header. Must be a .zip filename.' });
          return;
        }
        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          res.status(400).json({ error: 'Missing or empty zip file body' });
          return;
        }
        const repoName = zipName.replace(/\.zip$/i, '') + '_zip';
        const codeDir = getCodeDir();
        const targetPath = path.resolve(codeDir, repoName);

        const entries = await readRegistry();
        if (entries.some((e) => pathEquals(e.path, targetPath))) {
          res.json({ ok: true, alreadyExists: true, path: targetPath, repoName, message: 'Zip already uploaded and indexed' });
          return;
        }

        await fs.mkdir(codeDir, { recursive: true });
        console.log('[zip-upload-analyze] extract start:', zipName);
        const zip = new AdmZip(body);

        // ZIP 内容可能有单个顶层目录（如 project-main/），也可能直接是文件
        // 统一解压到临时目录，再判断是否需要提升一层
        const tmpExtractPath = targetPath + '__zip_tmp__';
        zip.extractAllTo(tmpExtractPath, true);

        // 检查是否只有一个顶层目录（常见于 GitHub 下载的 zip）
        const topEntries = await fs.readdir(tmpExtractPath);
        let actualSrcPath = tmpExtractPath;
        if (topEntries.length === 1) {
          const single = path.join(tmpExtractPath, topEntries[0]);
          try {
            const stat = await fs.stat(single);
            if (stat.isDirectory()) actualSrcPath = single;
          } catch { /* ignore */ }
        }

        // 移动到最终目录
        await fs.rename(actualSrcPath, targetPath);
        // 清理临时目录（若提升了一层，tmpExtractPath 还在）
        try { await fs.rm(tmpExtractPath, { recursive: true, force: true }); } catch { /* ignore */ }

        console.log('[zip-upload-analyze] extract done:', targetPath);

        // analyze 要求目标是 git 仓库，ZIP 解压没有 .git，自动 git init
        const gitDir = path.join(targetPath, '.git');
        const hasGit = existsSync(gitDir);
        if (!hasGit) {
          const gitInitResult = spawnSync('git', ['init', targetPath], { stdio: 'pipe', encoding: 'utf-8' });
          if (gitInitResult.status !== 0) {
            console.warn('[zip-upload-analyze] git init failed:', gitInitResult.stderr);
          } else {
            // 做一次初始提交，让 analyze 能拿到 commit hash
            spawnSync('git', ['-C', targetPath, 'add', '-A'], { stdio: 'pipe', encoding: 'utf-8' });
            spawnSync('git', ['-C', targetPath, 'commit', '--allow-empty', '-m', 'init from zip upload', '--author', 'gitnexus <gitnexus@local>'], {
              stdio: 'pipe', encoding: 'utf-8',
              env: { ...process.env, GIT_AUTHOR_NAME: 'gitnexus', GIT_AUTHOR_EMAIL: 'gitnexus@local', GIT_COMMITTER_NAME: 'gitnexus', GIT_COMMITTER_EMAIL: 'gitnexus@local' },
            });
            console.log('[zip-upload-analyze] git init done:', targetPath);
          }
        }

        const __dirnameServer = path.dirname(fileURLToPath(import.meta.url));
        const pkgRoot = path.resolve(__dirnameServer, '../..');
        const scriptCandidates = [
          path.resolve(pkgRoot, '..', 'convert_to_utf8.py'),
          path.join(pkgRoot, 'scripts', 'convert_to_utf8.py'),
        ];
        const convertScript = scriptCandidates.find((p) => existsSync(p));
        if (convertScript) {
          const pyCandidates = process.platform === 'win32' ? ['python3', 'python', 'py'] : ['python3', 'python'];
          for (const py of pyCandidates) {
            const convertResult = spawnSync(
              py,
              process.platform === 'win32' && py === 'py' ? ['-3', convertScript, targetPath] : [convertScript, targetPath],
              { stdio: 'pipe', encoding: 'utf-8', shell: false }
            );
            const errObj = convertResult.error as NodeJS.ErrnoException | undefined;
            if (errObj?.code === 'ENOENT') continue;
            if (convertResult.status === 0) {
              console.log('[zip-upload-analyze] UTF-8 conversion done');
              break;
            }
          }
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        const send = (data: object) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        send({ type: 'extract_done', path: targetPath });

        const cliPath = path.join(__dirnameServer, '../cli/index.js');
        const nodeOptions = (process.env.NODE_OPTIONS || '').trim();
        const analyzeEnv = {
          ...process.env,
          NODE_OPTIONS: nodeOptions ? `${nodeOptions} --max-old-space-size=8192` : '--max-old-space-size=8192',
          GITNEXUS_PROGRESS: '1',
        };
        const analyzeArgs = [cliPath, 'analyze', targetPath];
        if (enableEmbeddings) {
          analyzeArgs.push('--embeddings');
          console.log('[zip-upload-analyze] embeddings enabled');
        }
        const child = spawn(process.execPath, analyzeArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: pkgRoot,
          env: analyzeEnv,
        });
        const rl = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
        let doneSent = false;
        let lastPhase = '';
        let lastPercent = -1;
        const finishResponse = () => {
          if (doneSent) return;
          doneSent = true;
          res.end();
        };
        rl.on('line', (line) => {
          if (doneSent) return;
          const trimmed = line.trim();
          if (!trimmed) return;
          try {
            const data = JSON.parse(trimmed);
            if (data.done) {
              send({ type: 'done', ok: true, path: data.path ?? targetPath, repoName });
              finishResponse();
            } else {
              const phase = data.phase ?? '';
              const percent = typeof data.percent === 'number' ? data.percent : 0;
              if (phase !== lastPhase || percent !== lastPercent) {
                lastPhase = phase;
                lastPercent = percent;
                send({ type: 'progress', phase, percent });
              }
            }
          } catch {
            if (trimmed !== lastPhase || 0 !== lastPercent) {
              lastPhase = trimmed;
              lastPercent = 0;
              send({ type: 'progress', phase: trimmed, percent: 0 });
            }
          }
        });
        child.stderr?.on('data', (chunk) => {
          process.stderr.write('[zip-upload-analyze] ' + chunk.toString());
        });
        child.on('close', (code) => {
          console.log('[zip-upload-analyze] analyze exit code:', code, targetPath);
          rl.close();
          if (!doneSent) {
            if (code === 0) send({ type: 'done', ok: true, path: targetPath, repoName });
            else send({ type: 'done', ok: false, error: 'Analyze exited with code ' + code });
            finishResponse();
          }
        });
        child.on('error', (err) => {
          rl.close();
          send({ type: 'done', ok: false, error: err.message });
          res.end();
        });
      } catch (err: any) {
        console.error('[zip-upload-analyze]', err);
        res.status(500).json({ error: err?.message || String(err) });
      }
    }
  );

  // List all registered repos
  app.get('/api/repos', async (_req, res) => {
    try {
      const repos = await listRegisteredRepos();
      res.json(repos.map(r => ({
        name: r.name, path: r.path, indexedAt: r.indexedAt,
        lastCommit: r.lastCommit, stats: r.stats,
      })));
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to list repos' });
    }
  });

  // Get repo info
  app.get('/api/repo', async (req, res) => {
    try {
      const entry = await resolveRepo(requestedRepo(req));
      if (!entry) {
        res.status(404).json({ error: 'Repository not found. Run: gitnexus analyze' });
        return;
      }
      const meta = await loadMeta(entry.storagePath);
      res.json({
        name: entry.name,
        repoPath: entry.path,
        indexedAt: meta?.indexedAt ?? entry.indexedAt,
        stats: meta?.stats ?? entry.stats ?? {},
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to get repo info' });
    }
  });

  // Get full graph
  app.get('/api/graph', async (req, res) => {
    try {
      const entry = await resolveRepo(requestedRepo(req));
      if (!entry) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const kuzuPath = path.join(entry.storagePath, 'kuzu');
      const graph = await withKuzuDb(kuzuPath, async () => buildGraph());
      res.json(graph);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to build graph' });
    }
  });

  // Execute Cypher query
  app.post('/api/query', async (req, res) => {
    try {
      const cypher = req.body.cypher as string;
      if (!cypher) {
        res.status(400).json({ error: 'Missing "cypher" in request body' });
        return;
      }

      const entry = await resolveRepo(requestedRepo(req));
      if (!entry) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const kuzuPath = path.join(entry.storagePath, 'kuzu');
      const result = await withKuzuDb(kuzuPath, () => executeQuery(cypher));
      res.json({ result });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Query failed' });
    }
  });

  // Search
  app.post('/api/search', async (req, res) => {
    try {
      const query = (req.body.query ?? '').trim();
      if (!query) {
        res.status(400).json({ error: 'Missing "query" in request body' });
        return;
      }

      const entry = await resolveRepo(requestedRepo(req));
      if (!entry) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const kuzuPath = path.join(entry.storagePath, 'kuzu');
      const parsedLimit = Number(req.body.limit ?? 10);
      const limit = Number.isFinite(parsedLimit)
        ? Math.max(1, Math.min(100, Math.trunc(parsedLimit)))
        : 10;

      const results = await withKuzuDb(kuzuPath, async () => {
        const { isEmbedderReady } = await import('../core/embeddings/embedder.js');
        if (isEmbedderReady()) {
          const { semanticSearch } = await import('../core/embeddings/embedding-pipeline.js');
          return hybridSearch(query, limit, executeQuery, semanticSearch);
        }
        // FTS-only fallback when embeddings aren't loaded
        return searchFTSFromKuzu(query, limit);
      });
      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Search failed' });
    }
  });

  // Read file — with path traversal guard
  app.get('/api/file', async (req, res) => {
    try {
      const entry = await resolveRepo(requestedRepo(req));
      if (!entry) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: 'Missing path' });
        return;
      }

      // Prevent path traversal — resolve and verify the path stays within the repo root
      const repoRoot = path.resolve(entry.path);
      const fullPath = path.resolve(repoRoot, filePath);
      if (!fullPath.startsWith(repoRoot + path.sep) && fullPath !== repoRoot) {
        res.status(403).json({ error: 'Path traversal denied' });
        return;
      }

      const content = await fs.readFile(fullPath, 'utf-8');
      res.json({ content });
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        res.status(404).json({ error: 'File not found' });
      } else {
        res.status(500).json({ error: err.message || 'Failed to read file' });
      }
    }
  });

  // List all processes
  app.get('/api/processes', async (req, res) => {
    try {
      const result = await backend.queryProcesses(requestedRepo(req));
      res.json(result);
    } catch (err: any) {
      res.status(statusFromError(err)).json({ error: err.message || 'Failed to query processes' });
    }
  });

  // Process detail
  app.get('/api/process', async (req, res) => {
    try {
      const name = String(req.query.name ?? '').trim();
      if (!name) {
        res.status(400).json({ error: 'Missing "name" query parameter' });
        return;
      }

      const result = await backend.queryProcessDetail(name, requestedRepo(req));
      if (result?.error) {
        res.status(404).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err: any) {
      res.status(statusFromError(err)).json({ error: err.message || 'Failed to query process detail' });
    }
  });

  // List all clusters
  app.get('/api/clusters', async (req, res) => {
    try {
      const result = await backend.queryClusters(requestedRepo(req));
      res.json(result);
    } catch (err: any) {
      res.status(statusFromError(err)).json({ error: err.message || 'Failed to query clusters' });
    }
  });

  // Cluster detail
  app.get('/api/cluster', async (req, res) => {
    try {
      const name = String(req.query.name ?? '').trim();
      if (!name) {
        res.status(400).json({ error: 'Missing "name" query parameter' });
        return;
      }

      const result = await backend.queryClusterDetail(name, requestedRepo(req));
      if (result?.error) {
        res.status(404).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err: any) {
      res.status(statusFromError(err)).json({ error: err.message || 'Failed to query cluster detail' });
    }
  });

  // Git 代理：供 Web 端 Local Git 经本机转发请求，解决跨域/鉴权（仅允许 http/https）
  const proxyHandler: express.RequestHandler = async (req, res) => {
    const url = typeof req.query.url === 'string' ? req.query.url : '';
    if (!url) {
      res.status(400).json({ error: 'Missing url query parameter' });
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({ error: 'Only http/https URLs are allowed' });
      return;
    }
    const urlLabel = `${parsed.host}${parsed.pathname.length > 60 ? parsed.pathname.slice(0, 60) + '...' : parsed.pathname}`;
    const method = req.method || 'GET';
    console.log(`[proxy] ${method} ${urlLabel} -> 请求中...`);
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'git/isomorphic-git',
      };
      if (req.headers.authorization) headers['Authorization'] = req.headers.authorization as string;
      if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'] as string;
      if (req.headers['git-protocol']) headers['Git-Protocol'] = req.headers['git-protocol'] as string;
      if (req.headers.accept) headers['Accept'] = req.headers.accept as string;

      const body = req.method === 'POST' && Buffer.isBuffer(req.body) ? req.body : undefined;
      const response = await fetch(url, {
        method,
        headers,
        body,
      });

      const buf = await response.arrayBuffer();
      const size = buf.byteLength;
      const sizeStr = size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)}MB` : size >= 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;
      console.log(`[proxy] ${method} ${urlLabel} -> ${response.status} ${sizeStr} (正常拉取)`);

      res.setHeader('Access-Control-Expose-Headers', '*');
      const skip = ['content-encoding', 'transfer-encoding', 'connection', 'www-authenticate'];
      response.headers.forEach((value, key) => {
        if (!skip.includes(key.toLowerCase())) res.setHeader(key, value);
      });
      res.status(response.status);
      res.end(Buffer.from(buf));
    } catch (err: any) {
      console.error(`[proxy] ${method} ${urlLabel} -> 失败:`, err?.message || err);
      res.status(500).json({ error: 'Proxy request failed', details: err?.message || String(err) });
    }
  };
  app.get('/api/proxy', proxyHandler);
  app.post('/api/proxy', express.raw({ type: '*/*', limit: '50mb' }), proxyHandler);

  // 临时：服务端本地测试代理能否拉取指定 Git 仓库（GET /api/proxy/test?url=...&token=可选）
  app.get('/api/proxy/test', async (req, res) => {
    const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : undefined;
    if (!url) {
      res.status(400).json({ ok: false, error: 'Missing url query parameter. Example: /api/proxy/test?url=https://host/repo.git' });
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      res.status(400).json({ ok: false, error: 'Invalid URL' });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({ ok: false, error: 'Only http/https URLs are allowed' });
      return;
    }
    const base = url.replace(/\/+$/, '').replace(/\.git$/i, '');
    const testUrl = `${base}.git/info/refs?service=git-upload-pack`;
    console.log(`[proxy/test] 测试拉取: ${url}`);
    try {
      const headers: Record<string, string> = { 'User-Agent': 'git/isomorphic-git', Accept: '*/*' };
      if (token) headers['Authorization'] = `Basic ${Buffer.from(`${token}:`, 'utf8').toString('base64')}`;
      const response = await fetch(testUrl, { method: 'GET', headers });
      if (response.ok) {
        console.log(`[proxy/test] 正常拉取: ${url} -> OK`);
        res.json({ ok: true, message: 'Server can reach the Git repo (info/refs OK)' });
      } else {
        console.log(`[proxy/test] 拉取失败: ${url} -> ${response.status}`);
        res.status(response.status).json({
          ok: false,
          error: `Git server returned ${response.status}`,
          status: response.status,
        });
      }
    } catch (err: any) {
      console.error('Proxy test error:', err);
      res.status(500).json({
        ok: false,
        error: err?.message || String(err),
      });
    }
  });

  // Global error handler — catch anything the route handlers miss
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const server = app.listen(port, host, () => {
    console.log(`GitNexus server running on http://${host}:${port}`);
  });

  // Graceful shutdown — close Express + KuzuDB cleanly
  const shutdown = async () => {
    server.close();
    await cleanupMcp();
    await closeKuzu();
    await backend.disconnect();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};
