/**
 * Run scripts/convert_to_utf8.py on a workspace — same behavior as clone-analyze / zip-upload.
 * Converts legacy encodings (e.g. GBK) to UTF-8 without BOM.
 */

import path from 'path';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(serverDir, '../..');

export interface ConvertToUtf8Result {
  ok: boolean;
  /** True when script file was missing */
  skipped: boolean;
  detail: string;
}

/**
 * @param logPrefix e.g. `[clone-analyze]` or `[nightly-refresh]`
 */
export function convertWorkspaceToUtf8(targetPath: string, logPrefix = '[utf8]'): ConvertToUtf8Result {
  const scriptCandidates = [
    path.resolve(pkgRoot, '..', 'convert_to_utf8.py'),
    path.join(pkgRoot, 'scripts', 'convert_to_utf8.py'),
  ];
  const convertScript = scriptCandidates.find((p) => existsSync(p));
  if (!convertScript) {
    const detail = `${logPrefix} UTF-8 conversion skipped: convert_to_utf8.py not found. Tried: ${scriptCandidates.join(', ')}`;
    console.warn(detail);
    return { ok: false, skipped: true, detail };
  }

  const pyCandidates = process.platform === 'win32'
    ? ['python3', 'python', 'py']
    : ['python3', 'python'];

  for (const py of pyCandidates) {
    const convertResult = spawnSync(
      py,
      process.platform === 'win32' && py === 'py' ? ['-3', convertScript, targetPath] : [convertScript, targetPath],
      { stdio: 'pipe', encoding: 'utf-8', shell: false },
    );
    const errObj = convertResult.error as NodeJS.ErrnoException | undefined;
    if (errObj?.code === 'ENOENT') continue;
    if (convertResult.status === 0) {
      const detail = `${logPrefix} UTF-8 conversion done (via ${py})`;
      console.log(detail);
      return { ok: true, skipped: false, detail };
    }
    const err = (convertResult.stderr || convertResult.stdout || convertResult.error?.message || '').slice(0, 800);
    console.warn(`${logPrefix} UTF-8 conversion failed with ${py}:`, convertResult.status, err);
  }

  const detail =
    `${logPrefix} GBK/other encodings were not converted to UTF-8. Install Python and ensure gitnexus/scripts/convert_to_utf8.py is available.`;
  console.warn(detail);
  return { ok: false, skipped: false, detail };
}
