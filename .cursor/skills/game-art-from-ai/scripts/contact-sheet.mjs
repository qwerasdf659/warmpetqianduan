/**
 * 生成贴图对照表：把某个目录下的 PNG 拼成缩略图网格并截图，方便肉眼挑选。
 * 用法: node sheet.mjs <绝对目录> <输出png> <单格px>
 */
import { chromium } from 'playwright';
import { readdirSync } from 'fs';
import { pathToFileURL } from 'url';
import path from 'path';

const [, , dir, out, cellArg] = process.argv;
const cell = Number(cellArg || 150);

const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort();
const cols = 6;

const items = files
  .map((f) => {
    const url = pathToFileURL(path.join(dir, f)).href;
    const name = f.replace(/\.png$/i, '');
    return `<div class="c"><div class="i"><img src="${url}"></div><div class="n">${name}</div></div>`;
  })
  .join('');

const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#2b2b2b;font:12px/1.3 Consolas,monospace;color:#fff}
.g{display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:8px;padding:10px}
.c{width:${cell}px}
.i{width:${cell}px;height:${cell}px;background:
   linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%),
   linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%);
   background-size:16px 16px;background-position:0 0,8px 8px;
   display:flex;align-items:center;justify-content:center;overflow:hidden}
.i img{max-width:100%;max-height:100%;object-fit:contain}
.n{text-align:center;padding:2px 0;font-size:11px;word-break:break-all}
</style><div class="g">${items}</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: cols * (cell + 8) + 20, height: 900 } });
await page.setContent(html);
await page.waitForTimeout(1500);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`ok ${files.length} files -> ${out}`);
