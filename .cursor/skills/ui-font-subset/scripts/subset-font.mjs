/**
 * 字体子集化：从完整字库里只保留工程实际用到的字。
 *
 * 这是「用漂亮中文字体 + 4MB 主包上限」唯一可行的组合方式：
 * 完整 Resource Han Rounded CN Bold 是 13.3MB，子集化后是几百 KB。
 *
 * **字表必须由 `scan-chars-ui.mjs` 扫出来，不要人手维护。**
 * 手维护的字表漏字时，运行时那个字变成空白/方框 —— 不报错、
 * 只在特定界面出现，极难发现。加了新入口就重跑扫描再跑本脚本。
 *
 * 除了汉字，还必须补上这几类，否则它们会变方框：
 * ASCII（数字、字母、`/`、`:`）、全角标点、以及界面里用到的特殊符号。
 *
 * 用法：node scripts/subset-font.mjs [源字体] [字表] [输出目录]
 */
import Fontmin from 'fontmin';
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve(process.argv[2] || 'font/rhr/ResourceHanRoundedCN-Bold.ttf');
const charFile = path.resolve(process.argv[3] || 'chars-ui.txt');
const outDir = path.resolve(process.argv[4] || 'font/out');

const cjk = fs.readFileSync(charFile, 'utf8');

// ASCII 可打印区：数字、字母、以及 `/` `:` `%` `+` `-` 这些界面里到处都有的符号。
// 漏了的话「40/150」这种进度文本会缺字符。
let ascii = '';
for (let c = 0x20; c <= 0x7e; c++) ascii += String.fromCharCode(c);

// 全角标点与常用符号。中文界面里的逗号句号是全角的，和 ASCII 不是同一个码位。
// 弯引号 " " ' ' 用 Unicode 转义写：直接写进字面量会撞引号边界，
// 报 `SyntaxError: Unexpected string`，而报错位置指向整行、看不出是哪个字符。
const punct =
  '，。、；：？！（）【】《》〈〉…—～·　％＋－×÷' +
  '\u201c\u201d\u2018\u2019';

const chars = [...new Set((ascii + punct + cjk).split(''))].join('');
console.log(`保留字符数: ${chars.length}（汉字 ${new Set(cjk.split('')).size} + ASCII ${ascii.length} + 标点 ${punct.length}）`);

fs.mkdirSync(outDir, { recursive: true });

const fontmin = new Fontmin()
  .src(src)
  .use(Fontmin.glyph({ text: chars, hinting: false }))
  // woff2 比 ttf 小很多（实测约 1/3），而 Cocos 的 Label 走浏览器字体栈、
  // 微信小游戏也支持 woff2。ttf 一起产出留作兜底。
  .use(Fontmin.ttf2woff2())
  .dest(outDir);

fontmin.run((err, files) => {
  if (err) {
    console.error('子集化失败:', err.message);
    process.exit(1);
  }
  const srcMB = (fs.statSync(src).size / 1024 / 1024).toFixed(1);
  console.log(`\n源字体 ${srcMB}MB →`);
  for (const f of files) {
    const p = f.path;
    if (!fs.existsSync(p)) continue;
    const kb = (fs.statSync(p).size / 1024).toFixed(0);
    console.log(`  ${String(kb).padStart(5)}KB  ${path.basename(p)}`);
  }
});
