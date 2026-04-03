/**
 * Optional repo-root filter config: `gitnexus.filter` (JSON), PROCESS section only.
 * @see docs/plans/2026-04-03-gitnexus-filter-process-design.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';

/** Normalized PROCESS filter: non-empty arrays mean that rule is active. */
export interface ProcessFilterConfig {
  filePatterns: string[];
  classPatterns: string[];
}

const FILTER_FILENAME = 'gitnexus.filter';

function warn(msg: string): void {
  console.warn(`[GitNexus] ${msg}`);
}

/**
 * Parse `gitnexus.filter` JSON body. Invalid JSON or missing `PROCESS` → warn, `undefined`.
 * Non-string array entries are skipped with a warning; the rest of `PROCESS` still applies.
 */
export function parseProcessFilterFromJson(text: string): ProcessFilterConfig | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (e) {
    warn(`gitnexus.filter: invalid JSON (${(e as Error).message}) — ignoring PROCESS filters`);
    return undefined;
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    warn('gitnexus.filter: root must be an object — ignoring PROCESS filters');
    return undefined;
  }

  const proc = (raw as Record<string, unknown>).PROCESS;
  if (proc === undefined) {
    warn('gitnexus.filter: missing key "PROCESS" — ignoring PROCESS filters');
    return undefined;
  }
  if (proc === null || typeof proc !== 'object' || Array.isArray(proc)) {
    warn('gitnexus.filter: "PROCESS" must be an object — ignoring PROCESS filters');
    return undefined;
  }

  const p = proc as Record<string, unknown>;
  const filePatterns = normalizePatternList(p.FILE, 'FILE');
  const classPatterns = normalizePatternList(p.CLASS, 'CLASS');

  if (filePatterns.length === 0 && classPatterns.length === 0) {
    return undefined;
  }
  return { filePatterns, classPatterns };
}

function normalizePatternList(value: unknown, key: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    warn(`gitnexus.filter: PROCESS.${key} must be an array — skipping ${key} rules`);
    return [];
  }
  const out: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const el = value[i];
    if (typeof el === 'string') {
      out.push(el);
    } else {
      warn(`gitnexus.filter: PROCESS.${key}[${i}] is not a string — skipping entry`);
    }
  }
  return out;
}

/** Read `{repoRoot}/gitnexus.filter` from disk. Missing file → `undefined` (no warning). */
export function loadGitNexusFilter(repoPath: string): ProcessFilterConfig | undefined {
  const fp = path.join(repoPath, FILTER_FILENAME);
  if (!fs.existsSync(fp)) return undefined;
  try {
    const text = fs.readFileSync(fp, 'utf8');
    return parseProcessFilterFromJson(text);
  } catch (e) {
    warn(`gitnexus.filter: failed to read ${fp}: ${(e as Error).message}`);
    return undefined;
  }
}

const win = (): boolean => process.platform === 'win32';

/** Normalize repo-relative path for comparison (slashes; optional case fold on Windows). */
export function normalizeRepoRelativePath(filePath: string): string {
  let n = path.normalize(filePath).replace(/\\/g, '/');
  if (win()) n = n.toLowerCase();
  return n;
}

function normalizePatternForOs(pattern: string): string {
  let p = pattern.replace(/\\/g, '/');
  if (win()) p = p.toLowerCase();
  return p;
}

/**
 * True if `filePath` matches any glob pattern (full path and basename, minimatch).
 */
export function filePathMatchesProcessFilter(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0 || !filePath) return false;
  const np = normalizeRepoRelativePath(filePath);
  const base = win() ? path.basename(np).toLowerCase() : path.basename(np);
  const opts = { dot: true } as const;
  for (const pat of patterns) {
    const p = normalizePatternForOs(pat);
    if (minimatch(np, p, opts) || minimatch(base, p, opts)) return true;
  }
  return false;
}

/** Strip optional `Class:` prefix from user patterns. */
function normalizeClassPattern(pattern: string): string {
  return pattern.replace(/^Class:/i, '');
}

/**
 * True if short class name matches any pattern (minimatch on class name).
 */
export function classNameMatchesProcessFilter(className: string, patterns: string[]): boolean {
  if (patterns.length === 0 || !className) return false;
  const name = win() ? className.toLowerCase() : className;
  const opts = { dot: true } as const;
  for (const pat of patterns) {
    const p = normalizePatternForOs(normalizeClassPattern(pat));
    if (minimatch(name, p, opts)) return true;
  }
  return false;
}
