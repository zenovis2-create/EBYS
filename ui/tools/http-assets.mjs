// Static asset check against a running EBYS server (GET only; no API or model calls).
// Usage: node ui/tools/http-assets.mjs http://127.0.0.1:8787
import { createHash } from 'node:crypto';

const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const pngSize = (b) => (b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : 'not-png');
let fails = 0;
const line = (ok, msg) => { if (!ok) fails += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const html = await (await fetch(`${base}/`)).text();
for (const ref of ['assets/ebys-icon-32.png', 'assets/ebys-icon-192.png', 'assets/ebys-icon-180.png', 'manifest.json']) line(html.includes(`href="${ref}"`), `index.html links ${ref}`);

const m = await fetch(`${base}/manifest.json`);
const man = await m.json();
line(m.ok && m.headers.get('content-type').includes('json'), `manifest.json ${m.status} ${m.headers.get('content-type')} display=${man.display}`);

const files = [...new Set(['assets/ebys-icon-32.png', 'assets/ebys-icon-96.png', 'assets/ebys-icon-180.png', ...man.icons.map((i) => i.src)])];
for (const f of files) {
  const r = await fetch(`${base}/${f}`);
  const b = Buffer.from(await r.arrayBuffer());
  const stated = man.icons.find((i) => i.src === f)?.sizes ?? f.match(/-(\d+)\.png$/)?.[1].replace(/^(\d+)$/, '$1x$1');
  const extra = f.endsWith('original.png') ? ` sha256=${createHash('sha256').update(b).digest('hex').toUpperCase()}` : '';
  line(r.ok && r.headers.get('content-type') === 'image/png' && pngSize(b) === stated, `${f} ${r.status} ${r.headers.get('content-type')} ${pngSize(b)} ${b.length}B${extra}`);
}
console.log(fails ? `${fails} FAIL` : 'all asset checks passed');
process.exitCode = fails ? 1 : 0;
