/**
 * Fork-local HTTP routes: SSE clone-analyze + zip upload analyze.
 * See docs/CLONE_ANALYZE_REPO_BRANCH_NAMING.md — branch directory naming uses @@ slug.
 */

import express from 'express';
import path from 'path';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import { spawn, spawnSync } from 'child_process';
import * as readline from 'readline';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { readRegistry, getStoragePaths } from '../storage/repo-manager.js';
import { isGitRepo } from '../storage/git.js';
import { convertWorkspaceToUtf8 } from './utf8-conversion.js';
import { closeLbugForPath } from '../core/lbug/lbug-adapter.js';

const GINEXUS_CODE_DIR = 'gitnexus_code';

const getCodeBaseDir = (): string =>
  process.env.HOME || process.env.USERPROFILE || process.cwd();

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

export function registerLocalGitRoutes(
  app: express.Application,
  options: { enableEmbeddings: boolean },
): void {
  const { enableEmbeddings } = options;
  const __dirnameServer = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(__dirnameServer, '../..');

  app.post('/api/repos/clone-analyze', async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : undefined;
    const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : undefined;

    if (!url) {
      res.status(400).json({
        error: 'Missing url in body. Example: { "url": "https://host/org/repo.git", "token": "optional", "branch": "optional" }',
      });
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
    const dirSuffix = branch ? `@@${branch.replace(/[^a-zA-Z0-9_\-]/g, '_')}` : '';
    const targetPath = path.resolve(codeDir, repoName + dirSuffix);

    const entries = await readRegistry();
    if (entries.some((e) => pathEquals(e.path, targetPath))) {
      res.json({
        ok: true,
        alreadyExists: true,
        path: targetPath,
        message: 'Repo already in registry, skip clone',
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const send = (data: object) => {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* client disconnected */
      }
    };

    try {
      await fs.mkdir(codeDir, { recursive: true });

      send({ type: 'progress', phase: 'cloning', percent: 0 });
      console.log('[clone-analyze] clone start:', url, branch ? `(branch: ${branch})` : '(default branch)');

      const cloneUrl = token
        ? `${parsed.protocol}//${encodeURIComponent(token)}@${parsed.host}${parsed.pathname}${url.endsWith('.git') ? '' : '.git'}`
        : url.replace(/\.git$/i, '') + (url.match(/\.git$/i) ? '' : '.git');
      const cloneArgs = ['clone', '--depth', '1', '--progress'];
      if (branch) {
        cloneArgs.push('--branch', branch, '--single-branch');
      }
      cloneArgs.push(cloneUrl, targetPath);

      const cloneProcess = spawn('git', cloneArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let cloneOutput = '';
      const cloneStartTime = Date.now();
      const CLONE_TIMEOUT_S = 300;
      let lastClonePercent = 0;

      const calcTimePercent = () => {
        const elapsed = (Date.now() - cloneStartTime) / 1000;
        const ratio = Math.min(elapsed / CLONE_TIMEOUT_S, 0.99);
        return Math.round(((-Math.log(1 - ratio) / -Math.log(1 - 0.99)) * 48) / 10) / 10;
      };

      const cloneHeartbeatInterval = setInterval(() => {
        const timePct = calcTimePercent();
        if (timePct > lastClonePercent) {
          lastClonePercent = timePct;
          const elapsed = Math.round((Date.now() - cloneStartTime) / 1000);
          send({
            type: 'progress',
            phase: 'cloning',
            percent: lastClonePercent,
            detail: `Cloning... (${elapsed}s)`,
          });
        }
      }, 1000);

      const handleCloneProgress = (output: string) => {
        const progressMatch = output.match(/(\d+)%/);
        if (progressMatch) {
          const rawPct = parseInt(progressMatch[1], 10);
          const gitMapped = (rawPct / 100) * 4.8;
          const timePct = calcTimePercent();
          const best = Math.max(gitMapped, timePct);
          if (best > lastClonePercent) {
            lastClonePercent = best;
            send({ type: 'progress', phase: 'cloning', percent: lastClonePercent });
          }
        }
      };

      cloneProcess.stdout?.on('data', (chunk) => {
        const output = chunk.toString('utf-8');
        cloneOutput += output;
        handleCloneProgress(output);
      });

      cloneProcess.stderr?.on('data', (chunk) => {
        const output = chunk.toString('utf-8');
        cloneOutput += output;
        handleCloneProgress(output);
      });

      await new Promise<void>((resolve, reject) => {
        cloneProcess.on('close', async (code) => {
          clearInterval(cloneHeartbeatInterval);
          if (code !== 0) {
            const stderr =
              cloneOutput || (cloneProcess.stderr ? cloneProcess.stderr.read()?.toString('utf-8') : '') || '';
            console.error('[clone-analyze] git clone failed:', stderr);

            if (stderr.includes('already exists and is not an empty directory')) {
              if (isGitRepo(targetPath)) {
                const entries2 = await readRegistry();
                const existsInRegistry = entries2.some((e) => pathEquals(e.path, targetPath));

                if (existsInRegistry) {
                  console.log('[clone-analyze] Directory exists and is in registry, returning alreadyExists');
                  send({
                    type: 'done',
                    ok: true,
                    alreadyExists: true,
                    path: targetPath,
                    message: 'Repo already exists and is indexed',
                  });
                  resolve();
                  return;
                }
                console.log(
                  '[clone-analyze] Directory exists and is a valid git repo, but not in registry. Returning alreadyExists to trigger server mode.',
                );
                send({
                  type: 'done',
                  ok: true,
                  alreadyExists: true,
                  path: targetPath,
                  message: 'Repo directory exists, please use server mode',
                });
                resolve();
                return;
              }
            }

            send({ type: 'done', ok: false, error: 'Clone failed', details: stderr.slice(0, 500) });
            reject(new Error('Clone failed: ' + stderr.slice(0, 500)));
          } else {
            console.log('[clone-analyze] clone done:', targetPath);
            send({ type: 'clone_done', path: targetPath });
            resolve();
          }
        });
        cloneProcess.on('error', (err) => {
          clearInterval(cloneHeartbeatInterval);
          console.error('[clone-analyze] git clone error:', err);
          send({ type: 'done', ok: false, error: err.message });
          reject(err);
        });
      });

      send({ type: 'progress', phase: 'converting', percent: Math.max(lastClonePercent, 5) });
      convertWorkspaceToUtf8(targetPath, '[clone-analyze]');

      console.log('[clone-analyze] -> starting analyze');
      send({ type: 'progress', phase: 'Scanning files', percent: 5 });

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
      let lastFilesProcessed: number | undefined = undefined;
      let lastTotalFiles: number | undefined = undefined;
      const finishResponse = () => {
        if (doneSent) return;
        doneSent = true;
        res.end();
      };

      const shouldFilterStderr = (msg: string): boolean => {
        if (
          msg.includes('Unable to determine content-length') ||
          msg.includes('Will expand buffer when needed')
        ) {
          return true;
        }
        return false;
      };

      rl.on('line', (line) => {
        if (doneSent) return;
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const data = JSON.parse(trimmed) as {
            done?: boolean;
            phase?: string;
            percent?: number;
            filesProcessed?: number;
            totalFiles?: number;
            path?: string;
          };
          if (data.done) {
            send({ type: 'progress', phase: 'Analysis complete', percent: 95 });
            send({ type: 'done', ok: true, path: data.path ?? targetPath });
            finishResponse();
          } else {
            const phase = data.phase ?? '';
            const percent = typeof data.percent === 'number' ? data.percent : 0;
            const filesProcessed =
              typeof data.filesProcessed === 'number' ? data.filesProcessed : undefined;
            const totalFiles = typeof data.totalFiles === 'number' ? data.totalFiles : undefined;
            const mappedPercent = 5 + Math.round(percent * 0.9);
            const phaseChanged = phase !== lastPhase;
            const percentChanged = mappedPercent !== lastPercent;
            const filesChanged =
              filesProcessed !== lastFilesProcessed || totalFiles !== lastTotalFiles;
            if (phaseChanged || percentChanged || filesChanged) {
              lastPhase = phase;
              lastPercent = mappedPercent;
              lastFilesProcessed = filesProcessed;
              lastTotalFiles = totalFiles;
              const progressData: Record<string, unknown> = {
                type: 'progress',
                phase,
                percent: mappedPercent,
              };
              if (filesProcessed !== undefined) progressData.filesProcessed = filesProcessed;
              if (totalFiles !== undefined) progressData.totalFiles = totalFiles;
              send(progressData);
            }
          }
        } catch {
          /* non-JSON lines */
        }
      });
      child.stderr?.on('data', (chunk) => {
        const msg = chunk.toString();
        if (!shouldFilterStderr(msg)) {
          process.stderr.write('[clone-analyze] ' + msg);
        }
      });
      child.on('close', async (code) => {
        console.log('[clone-analyze] analyze exit code:', code, targetPath);
        rl.close();
        try {
          const { lbugPath } = getStoragePaths(targetPath);
          await closeLbugForPath(lbugPath);
        } catch {
          /* ignore */
        }
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[clone-analyze]', err);
      if (res.headersSent) {
        send({ type: 'done', ok: false, error: message });
        res.end();
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  app.post(
    '/api/repos/zip-upload-analyze',
    express.raw({ type: '*/*', limit: '500mb' }),
    async (req, res) => {
      try {
        const zipName = (typeof req.headers['x-zip-name'] === 'string' ? req.headers['x-zip-name'] : '').trim();
        if (!zipName || !/\.zip$/i.test(zipName)) {
          res.status(400).json({
            error: 'Missing or invalid X-Zip-Name header. Must be a .zip filename.',
          });
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
          res.json({
            ok: true,
            alreadyExists: true,
            path: targetPath,
            repoName,
            message: 'Zip already uploaded and indexed',
          });
          return;
        }

        await fs.mkdir(codeDir, { recursive: true });
        console.log('[zip-upload-analyze] extract start:', zipName);
        const zip = new AdmZip(body);

        const tmpExtractPath = targetPath + '__zip_tmp__';
        zip.extractAllTo(tmpExtractPath, true);

        const topEntries = await fs.readdir(tmpExtractPath);
        let actualSrcPath = tmpExtractPath;
        if (topEntries.length === 1) {
          const single = path.join(tmpExtractPath, topEntries[0]);
          try {
            const stat = await fs.stat(single);
            if (stat.isDirectory()) actualSrcPath = single;
          } catch {
            /* ignore */
          }
        }

        await fs.rename(actualSrcPath, targetPath);
        try {
          await fs.rm(tmpExtractPath, { recursive: true, force: true });
        } catch {
          /* ignore */
        }

        console.log('[zip-upload-analyze] extract done:', targetPath);

        const gitDir = path.join(targetPath, '.git');
        const hasGit = existsSync(gitDir);
        if (!hasGit) {
          const gitInitResult = spawnSync('git', ['init', targetPath], { stdio: 'pipe', encoding: 'utf-8' });
          if (gitInitResult.status !== 0) {
            console.warn('[zip-upload-analyze] git init failed:', gitInitResult.stderr);
          } else {
            spawnSync('git', ['-C', targetPath, 'add', '-A'], { stdio: 'pipe', encoding: 'utf-8' });
            spawnSync(
              'git',
              ['-C', targetPath, 'commit', '--allow-empty', '-m', 'init from zip upload', '--author', 'gitnexus <gitnexus@local>'],
              {
                stdio: 'pipe',
                encoding: 'utf-8',
                env: {
                  ...process.env,
                  GIT_AUTHOR_NAME: 'gitnexus',
                  GIT_AUTHOR_EMAIL: 'gitnexus@local',
                  GIT_COMMITTER_NAME: 'gitnexus',
                  GIT_COMMITTER_EMAIL: 'gitnexus@local',
                },
              },
            );
            console.log('[zip-upload-analyze] git init done:', targetPath);
          }
        }

        convertWorkspaceToUtf8(targetPath, '[zip-upload-analyze]');

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
            const data = JSON.parse(trimmed) as { done?: boolean; phase?: string; percent?: number; path?: string };
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
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[zip-upload-analyze]', err);
        res.status(500).json({ error: message });
      }
    },
  );
}
