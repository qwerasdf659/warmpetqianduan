/**
 * 扫出工程里实际用到的中文字符集，给字体子集化用。
 *
 * 这是「子集化」方案能自动化的前提：**字表由工程扫出来，不是人手维护的**。
 * 人手维护的字表迟早漏字，而漏字的表现是运行时那个字变成空白或方框 ——
 * 不报错、只在特定界面出现，极难发现。
 *
 * 扫描范围按 Cocos 工程的实际情况给（行业通行做法是这四类）：
 * 场景/预制体里的 Label 字符串、TS 源码里的字面量、JSON 配置。
 * 本项目的界面全是运行时代码搭的，所以 `assets/scripts/**` 是主战场。
 *
 * 用法：node scripts/scan-chars.mjs [工程根=..]
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '..');
const EXT = new Set(['.ts', '.json', '.scene', '.prefab']);
// 跳过构建产物与依赖：temp/ library/ 里是编译副本，会把同样的字重复算一遍，
// 而 node_modules 里的中文和游戏文案无关
const SKIP = new Set(['node_modules', 'temp', 'library', 'build', '.git', '.build']);

const chars = new Set();
const perFile = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(p);
    } else if (EXT.has(path.extname(e.name))) {
      const txt = fs.readFileSync(p, 'utf8');
      // CJK 统一汉字基本区。标点/全角符号另算（子集化时要单独加，
      // 漏了的话「·」「…」这类会变方框）
      const m = txt.match(/[\u4e00-\u9fff]/g);
      if (m) {
        const before = chars.size;
        for (const c of m) chars.add(c);
        if (chars.size > before) {
          perFile.push([path.relative(root, p), m.length, chars.size - before]);
        }
      }
    }
  }
}

walk(root);

const sorted = [...chars].sort();
console.log(`不重复中文字符数: ${sorted.length}`);
console.log(`\n贡献新字最多的文件:`);
perFile.sort((a, b) => b[2] - a[2]).slice(0, 12)
  .forEach(([f, total, novel]) => console.log(`  +${String(novel).padStart(4)} 新字 (共${total}) ${f}`));

const outDir = path.resolve('.');
fs.writeFileSync(path.join(outDir, 'chars.txt'), sorted.join(''), 'utf8');
console.log(`\n字表已写入 .build/chars.txt`);

// 体积估算：思源黑体这类字库单字约 0.9~1.6KB（含 hinting），取 1.2KB 中值。
// 这只是数量级参考，真实体积要跑一遍 Fontmin 才准。
const est = Math.round((sorted.length * 1.2) / 1024 * 10) / 10;
console.log(`子集化体积粗估: ~${est} MB（按单字 1.2KB；实测要跑 Fontmin）`);
