/**
 * Nightly git sync aligned with clone-analyze goals:
 * 1) Clean working tree (reset + clean)
 * 2) Fetch origin and align to a specific branch (registry or current branch)
 * 3) Caller runs convertWorkspaceToUtf8 + analyze
 */

import { spawnSync } from 'child_process';

const runGit = (cwd: string, args: string[]) => {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    ok: r.status === 0,
    out: (r.stderr || r.stdout || '').trim(),
    code: r.status ?? -1,
  };
};

/** Current symbolic branch name, or null if detached / unknown */
export const getGitBranchName = (repoPath: string): string | null => {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repoPath,
    encoding: 'utf-8',
  });
  const s = r.stdout?.trim();
  if (r.status !== 0 || !s || s === 'HEAD') return null;
  return s;
};

/**
 * @param preferredBranch optional — from registry `branch`; otherwise uses current checkout name
 */
export const syncGitRepoLikeCloneAnalyze = (
  repoPath: string,
  preferredBranch?: string,
): { ok: boolean; log: string } => {
  const lines: string[] = [];

  const step = (label: string, g: ReturnType<typeof runGit>): boolean => {
    lines.push(`${label} (exit ${g.code})\n${g.out.slice(0, 3000)}`);
    return g.ok;
  };

  // 1) 清理仓库：去掉未提交修改与未跟踪文件（不删 ignored）
  let g = runGit(repoPath, ['reset', '--hard', 'HEAD']);
  if (!step('git reset --hard HEAD', g)) return { ok: false, log: lines.join('\n---\n') };

  g = runGit(repoPath, ['clean', '-fd']);
  if (!step('git clean -fd', g)) return { ok: false, log: lines.join('\n---\n') };

  g = runGit(repoPath, ['fetch', 'origin']);
  if (!step('git fetch origin', g)) return { ok: false, log: lines.join('\n---\n') };

  const branchName = (preferredBranch?.trim() || getGitBranchName(repoPath) || '').trim();
  if (!branchName) {
    lines.push(
      'Cannot resolve branch name. Checkout a branch in the repo or set "branch" on the registry entry in ~/.gitnexus/registry.json',
    );
    return { ok: false, log: lines.join('\n---\n') };
  }

  g = runGit(repoPath, ['checkout', branchName]);
  if (!g.ok) {
    g = runGit(repoPath, ['checkout', '-B', branchName, `origin/${branchName}`]);
    if (!step(`git checkout -B ${branchName} origin/${branchName}`, g)) return { ok: false, log: lines.join('\n---\n') };
  } else {
    step(`git checkout ${branchName}`, g);
  }

  g = runGit(repoPath, ['reset', '--hard', `origin/${branchName}`]);
  if (!g.ok) {
    g = runGit(repoPath, ['pull', 'origin', branchName, '--ff-only']);
    if (!step('git pull --ff-only (fallback)', g)) return { ok: false, log: lines.join('\n---\n') };
  } else {
    step(`git reset --hard origin/${branchName}`, g);
  }

  g = runGit(repoPath, ['clean', '-fd']);
  if (!step('git clean -fd (after sync)', g)) return { ok: false, log: lines.join('\n---\n') };

  return { ok: true, log: lines.join('\n---\n') };
};
