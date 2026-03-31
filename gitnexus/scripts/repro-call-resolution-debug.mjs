/**
 * Repro: CALLS edge missing for SetIPAndPort when receiver type is a macro alias
 * and another class also defines SetIPAndPort(same arity).
 *
 * Run (PowerShell):
 *   $env:GITNEXUS_DEBUG_CALLS='1'; $env:GITNEXUS_DEBUG_CALLS_NAME='SetIPAndPort'; npx tsx scripts/repro-call-resolution-debug.mjs
 *
 * Or all call sites:
 *   $env:GITNEXUS_DEBUG_CALLS='all'; npx tsx scripts/repro-call-resolution-debug.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';

process.env.GITNEXUS_DEBUG_CALLS ??= '1';
process.env.GITNEXUS_DEBUG_CALLS_NAME ??= 'SetIPAndPort';

const { runPipelineFromRepo } = await import('../src/core/ingestion/pipeline.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'test/fixtures/lang-resolution/cpp-call-resolution-debug-repro');

console.error('Fixture:', fixture);
console.error('GITNEXUS_DEBUG_CALLS=', process.env.GITNEXUS_DEBUG_CALLS, 'NAME=', process.env.GITNEXUS_DEBUG_CALLS_NAME ?? '(none)');
console.error('---');

await runPipelineFromRepo(fixture, () => {});

console.error('---');
console.error('Done. Expect resolve_fail for SetIPAndPort; ConnectMgr should still resolve.');
