/**
 * Scheduled git pull + full re-analyze for every registry entry.
 * Runs in-process when `gitnexus serve --nightly-refresh` is enabled.
 */

import path from 'path';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { listRegisteredRepos } from '../storage/repo-manager.js';
import { closeLbugForPath } from '../core/lbug/lbug-adapter.js';
import { evictPoolsForDbPath } from '../mcp/core/lbug-adapter.js';
import { setRepoMaintenance } from '../maintenance/repo-maintenance.js';
import { isGitRepo } from '../storage/git.js';
import type { LocalBackend } from '../mcp/local/local-backend.js';
import { syncGitRepoLikeCloneAnalyze } from './git-nightly-sync.js';
import { convertWorkspaceToUtf8 } from './utf8-conversion.js';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(serverDir, '../..');
const cliPath = path.join(serverDir, '../cli/index.js');

export interface NightlyRefreshOptions {
  hour: number;
  minute: number;
  embeddings: boolean;
}

/** Parse "HH:MM" (24h). Invalid input defaults to 02:00. */
export const parseNightlyAt = (s: string | undefined): { hour: number; minute: number } => {
  if (!s || typeof s !== 'string') return { hour: 2, minute: 0 };
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return { hour: 2, minute: 0 };
  const hour = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const minute = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return { hour, minute };
};

let lastRunDayKey: string | null = null;

const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/**
 * Fire every 30s; when local clock matches hour:minute, run once per calendar day.
 */
export const startNightlyRefreshScheduler = (backend: LocalBackend, opts: NightlyRefreshOptions): void => {
  const tick = async () => {
    const now = new Date();
    if (now.getHours() !== opts.hour || now.getMinutes() !== opts.minute) return;
    const key = dayKey(now);
    if (lastRunDayKey === key) return;
    lastRunDayKey = key;
    try {
      await runNightlyRefresh(backend, opts.embeddings);
    } catch (e) {
      console.error('[nightly-refresh] failed:', e);
    }
  };

  setInterval(() => {
    void tick();
  }, 30_000);

  console.log(
    `[nightly-refresh] enabled: daily at ${String(opts.hour).padStart(2, '0')}:${String(opts.minute).padStart(2, '0')} (local server time), sequential git sync + UTF-8 convert + analyze --force`,
  );
};

const runAnalyze = (repoPath: string, embeddings: boolean): { ok: boolean; stderr: string } => {
  const entryCli = existsSync(cliPath) ? cliPath : path.join(pkgRoot, 'dist/cli/index.js');
  const args = [entryCli, 'analyze', '--force', repoPath];
  if (embeddings) args.push('--embeddings');
  const nodeOptions = (process.env.NODE_OPTIONS || '').trim();
  const env = {
    ...process.env,
    NODE_OPTIONS: nodeOptions ? `${nodeOptions} --max-old-space-size=8192` : '--max-old-space-size=8192',
  };
  const r = spawnSync(process.execPath, args, {
    cwd: pkgRoot,
    env,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const stderr = (r.stderr || r.stdout || '').slice(0, 4000);
  return { ok: r.status === 0, stderr };
};

export const runNightlyRefresh = async (backend: LocalBackend, embeddings: boolean): Promise<void> => {
  const entries = await listRegisteredRepos({ validate: true });
  if (entries.length === 0) {
    console.log('[nightly-refresh] no registered repos, nothing to do');
    return;
  }

  console.log(`[nightly-refresh] starting ${entries.length} repo(s)`);

  for (const entry of entries) {
    const name = entry.name;
    const lbugPath = path.join(entry.storagePath, 'lbug');

    setRepoMaintenance(name, true);
    try {
      await closeLbugForPath(lbugPath);
      evictPoolsForDbPath(lbugPath);

      if (!isGitRepo(entry.path)) {
        console.warn(`[nightly-refresh] skip (not a git repo): ${name}`);
        continue;
      }

      // 与 clone-analyze 对齐：清理工作区 → fetch + 检出分支并对齐 origin → GBK/等转 UTF-8
      const sync = syncGitRepoLikeCloneAnalyze(entry.path, entry.branch);
      if (!sync.ok) {
        console.error(`[nightly-refresh] git sync failed for ${name}:\n`, sync.log.slice(0, 4000));
        continue;
      }

      convertWorkspaceToUtf8(entry.path, '[nightly-refresh]');

      const { ok, stderr } = runAnalyze(entry.path, embeddings);
      if (!ok) {
        console.error(`[nightly-refresh] analyze --force failed for ${name}:`, stderr.slice(0, 1200));
      } else {
        console.log(`[nightly-refresh] done: ${name}`);
      }
    } finally {
      setRepoMaintenance(name, false);
      await backend.reloadFromRegistry();
    }
  }

  console.log('[nightly-refresh] batch finished');
};
