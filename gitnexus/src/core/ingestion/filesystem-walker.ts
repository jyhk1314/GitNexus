import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { shouldIgnorePath } from '../../config/ignore-service.js';

export interface FileEntry {
  path: string;
  content: string;
}

/** Lightweight entry — path + size from stat, no content in memory */
export interface ScannedFile {
  path: string;
  size: number;
}

/** Path-only reference (for type signatures) */
export interface FilePath {
  path: string;
}

const READ_CONCURRENCY = 32;

/** Skip files larger than 2MB — they're usually generated/vendored and can crash tree-sitter */
const MAX_FILE_SIZE = 2 * 1024 * 1024;

/**
 * Phase 1: Scan repository — stat files to get paths + sizes, no content loaded.
 * Memory: ~10MB for 100K files vs ~1GB+ with content.
 */
export const walkRepositoryPaths = async (
  repoPath: string,
  onProgress?: (current: number, total: number, filePath: string) => void
): Promise<ScannedFile[]> => {
  const files = await glob('**/*', {
    cwd: repoPath,
    nodir: true,
    dot: false,
  });

  const filtered = files.filter(file => !shouldIgnorePath(file));
  const entries: ScannedFile[] = [];
  const skippedPaths: string[] = [];
  let processed = 0;

  for (let start = 0; start < filtered.length; start += READ_CONCURRENCY) {
    const batch = filtered.slice(start, start + READ_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async relativePath => {
        const fullPath = path.join(repoPath, relativePath);
        const stat = await fs.stat(fullPath);
        const normalized = relativePath.replace(/\\/g, '/');
        if (stat.size > MAX_FILE_SIZE) {
          return { skipped: normalized, size: stat.size };
        }
        return { path: normalized, size: stat.size };
      })
    );

    for (const result of results) {
      processed++;
      if (result.status === 'fulfilled' && result.value !== null) {
        if ('skipped' in result.value) {
          skippedPaths.push(result.value.skipped);
          onProgress?.(processed, filtered.length, result.value.skipped);
        } else {
          entries.push({ path: result.value.path, size: result.value.size });
          onProgress?.(processed, filtered.length, result.value.path);
        }
      } else {
        onProgress?.(processed, filtered.length, batch[results.indexOf(result)]);
      }
    }
  }

  if (skippedPaths.length > 0) {
    const list = skippedPaths.length <= 10
      ? skippedPaths.join(', ')
      : `${skippedPaths.slice(0, 10).join(', ')} ... +${skippedPaths.length - 10} more`;
    console.warn(`  Skipped ${skippedPaths.length} large files (>${MAX_FILE_SIZE / 1024}KB, likely generated/vendored): ${list}`);
  }

  return entries;
};

/**
 * Phase 2: Read file contents for a specific set of relative paths.
 * Returns a Map for O(1) lookup. Silently skips files that fail to read.
 */
export const readFileContents = async (
  repoPath: string,
  relativePaths: string[],
): Promise<Map<string, string>> => {
  const contents = new Map<string, string>();

  for (let start = 0; start < relativePaths.length; start += READ_CONCURRENCY) {
    const batch = relativePaths.slice(start, start + READ_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async relativePath => {
        const fullPath = path.join(repoPath, relativePath);
        const content = await fs.readFile(fullPath, 'utf-8');
        return { path: relativePath, content };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        contents.set(result.value.path, result.value.content);
      }
    }
  }

  return contents;
};

/**
 * Legacy API — scans and reads everything into memory.
 * Used by sequential fallback path only.
 */
export const walkRepository = async (
  repoPath: string,
  onProgress?: (current: number, total: number, filePath: string) => void
): Promise<FileEntry[]> => {
  const scanned = await walkRepositoryPaths(repoPath, onProgress);
  const contents = await readFileContents(repoPath, scanned.map(f => f.path));
  return scanned
    .filter(f => contents.has(f.path))
    .map(f => ({ path: f.path, content: contents.get(f.path)! }));
};
