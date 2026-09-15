/**
 * 只扫「会显示给玩家」的中文，排除注释。
 *
 * 为什么要和 `scan-chars.mjs` 分开：本项目注释写得很详细（规则要求解释「为什么」），
 * 全量扫出 1398 字里绝大部分来自注释。**按注释的字数去买字体预算是纯浪费**，
 * 但注释也不能不扫 —— 漏扫真实文案会让那个字在运行时变方框。
 * 所以两个脚本都留：这个给预算，全量那个给兜底核对。
 *
 * 做法：先剥掉 `//` 行注释和块注释，再从剩下的部分取字符串字面量里的中文。
 * 剥注释用的是朴素的状态机而不是正则 —— 正则处理不了「字符串里含 // 」的情况
 * （如 URL），会把后半个字符串当注释切掉、导致漏字。
 *
 * 用法：node scripts/scan-chars-ui.mjs [工程根=..]
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '..');
const SKIP = new Set(['node_modules', 'temp', 'library', 'build', '.git', '.build']);

/** 剥掉 TS 里的注释，保留字符串字面量原样 */
function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null; // 当前所在字符串的引号字符
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      if (c === '\\') {
        out += c + (n || '');
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const chars = new Set();
const samples = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(p);
      continue;
    }
    const ext = path.extname(e.name);
    if (ext !== '.ts' && ext !== '.json' && ext !== '.scene' && ext !== '.prefab') continue;
    let txt = fs.readFileSync(p, 'utf8');
    if (ext === '.ts') txt = stripComments(txt);
    // 只取字符串字面量内部的中文
    const lits = txt.match(/(['"`])(?:\\.|(?!\1)[\s\S])*\1/g) || [];
    for (const lit of lits) {
      const m = lit.match(/[\u4e00-\u9fff]/g);
      if (!m) continue;
      for (const c of m) chars.add(c);
      if (samples.length < 14 && lit.length < 46) samples.push(`${path.basename(p)}: ${lit}`);
    }
  }
}

walk(root);

const sorted = [...chars].sort();
console.log(`界面文案的不重复中文字符数: ${sorted.length}`);
console.log(`\n抽样（确认扫到的是真文案，不是注释）:`);
samples.forEach((s) => console.log('  ' + s));

fs.writeFileSync('chars-ui.txt', sorted.join(''), 'utf8');
console.log(`\n字表已写入 .build/chars-ui.txt`);
const est = Math.round((sorted.length * 1.2)) ;
console.log(`子集化体积粗估: ~${est} KB（按单字 1.2KB；实测要跑 Fontmin）`);
