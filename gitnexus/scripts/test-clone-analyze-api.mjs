#!/usr/bin/env node
/**
 * 测试 POST /api/repos/clone-analyze 的 SSE 进度流
 * 用法: node scripts/test-clone-analyze-api.mjs [git-url]
 * 例: node scripts/test-clone-analyze-api.mjs https://github.com/owner/small-repo.git
 * 需先启动: npx gitnexus serve --host 0.0.0.0 -p 6660
 */
const BASE = process.env.GITNEXUS_SERVE_URL || 'http://localhost:6660';
const url = process.argv[2] || 'https://github.com/isomorphic-git/isomorphic-git.git';

async function main() {
  console.log('POST', BASE + '/api/repos/clone-analyze');
  console.log('Body: { url:', url, '}\n');

  const res = await fetch(BASE + '/api/repos/clone-analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await res.json();
    console.log('[response]', data);
    if (!res.ok) process.exit(1);
    return;
  }

  if (!res.body || !ct.includes('text/event-stream')) {
    console.error('Unexpected response:', res.status, ct);
    process.exit(1);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n\n');
    buf = lines.pop() || '';
    for (const block of lines) {
      const m = block.match(/^data:\s*(.+)/m);
      if (m) {
        try {
          const data = JSON.parse(m[1].trim());
          if (data.type === 'progress') {
            console.log(`[progress] ${data.percent}% ${data.phase}`);
          } else {
            console.log('[event]', data);
          }
        } catch (e) {
          console.log('[raw]', m[1].slice(0, 80));
        }
      }
    }
  }
  if (buf.trim()) {
    const m = buf.match(/^data:\s*(.+)/m);
    if (m) {
      try {
        console.log('[event]', JSON.parse(m[1].trim()));
      } catch {}
    }
  }
  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
