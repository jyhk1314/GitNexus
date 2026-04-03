import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseProcessFilterFromJson,
  loadGitNexusFilter,
  filePathMatchesProcessFilter,
  classNameMatchesProcessFilter,
} from '../../src/core/ingestion/gitnexus-filter.js';

describe('parseProcessFilterFromJson', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns undefined for invalid JSON', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseProcessFilterFromJson('{')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('returns undefined when PROCESS is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseProcessFilterFromJson('{}')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('skips non-string FILE entries and keeps strings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = parseProcessFilterFromJson(
      JSON.stringify({ PROCESS: { FILE: ['a.ts', 1, null, 'b.ts'], CLASS: [] } }),
    );
    expect(c).toEqual({ filePatterns: ['a.ts', 'b.ts'], classPatterns: [] });
    expect(warn).toHaveBeenCalled();
  });

  it('returns undefined when PROCESS has no patterns after parse', () => {
    expect(parseProcessFilterFromJson(JSON.stringify({ PROCESS: { FILE: [], CLASS: [] } }))).toBeUndefined();
  });
});

describe('filePathMatchesProcessFilter / classNameMatchesProcessFilter', () => {
  it('matches basename-only patterns', () => {
    expect(filePathMatchesProcessFilter('src/foo/bar.ts', ['bar.ts'])).toBe(true);
  });

  it('matches glob on full path', () => {
    expect(filePathMatchesProcessFilter('src/foo/bar.ts', ['**/bar.ts'])).toBe(true);
  });

  it('matches class patterns with optional Class: prefix', () => {
    expect(classNameMatchesProcessFilter('MyService', ['Class:My*'])).toBe(true);
    expect(classNameMatchesProcessFilter('MyService', ['*Service'])).toBe(true);
  });
});

describe('loadGitNexusFilter', () => {
  it('reads repo root file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-filter-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'gitnexus.filter'),
        JSON.stringify({ PROCESS: { FILE: ['x.ts'], CLASS: [] } }),
        'utf8',
      );
      expect(loadGitNexusFilter(dir)).toEqual({ filePatterns: ['x.ts'], classPatterns: [] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined when file missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-filter-miss-'));
    try {
      expect(loadGitNexusFilter(dir)).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
