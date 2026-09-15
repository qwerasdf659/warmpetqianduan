/** 把透明 PNG 叠在深色底上，检查抠图残留与破洞 */
import { chromium } from 'playwright';
import { readdirSync } from 'fs';
import { pathToFileURL } from 'url';
import path from 'path';

const dir = process.argv[2];
const out = process.argv[3];
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();

const cells = files
  .map((f) => {
    const url = pathToFileURL(path.join(dir, f)).href;
    return `<div class="c"><div class="d"><img src="${url}"></div><div class="l"><img src="${url}"></div><div class="n">${f}</div></div>`;
  })
  .join('');

const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#111;font:12px monospace;color:#fff}
.g{display:grid;grid-template-columns:repeat(4,260px);gap:10px;padding:12px}
.c{width:260px}
.d{height:260px;background:#1b3a2a;display:flex;align-items:center;justify-content:center}
.l{height:260px;background:#f3e6d0;display:flex;align-items:center;justify-content:center}
img{max-width:100%;max-height:100%;object-fit:contain}
.n{text-align:center;padding:3px}
</style><div class="g">${cells}</div>`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 4 * 270 + 24, height: 620 } });
await p.setContent(html);
await p.waitForTimeout(1200);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log('ok ->', out);
