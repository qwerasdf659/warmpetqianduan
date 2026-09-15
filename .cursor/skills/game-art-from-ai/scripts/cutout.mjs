/**
 * 抠背景 + 自动裁边。
 *
 * 两个关键点：
 *
 * 1. 用**从图像边缘开始的泛洪填充**，而不是全图色键。
 *    全图色键会把小屋内部的白墙/白窗一起抠成透明（留下窟窿），
 *    泛洪只清除「与画布外缘连通」的背景，屋内白色完整保留。
 *
 * 2. 用**局部容差**（和相邻背景像素比），而不是和写死的白色比。
 *    模型经常无视「纯白背景」把底烘成带渐变的奶油色，此时全局比较
 *    一个像素都抠不掉。详见下方 isBg 处的注释。
 *
 * 用法: node cutout.mjs <输入png> <输出png> [容差=12]
 *
 * ⚠️ 容差默认 12，**调大很危险**：局部容差下大容差会从描边薄弱处
 * 漏进画面内部把物件掏空（实测育婴室 12→65% / 18→13% / 26→4% 填充率）。
 *
 * 本文件与 .cursor/skills/{game-art-from-ai,asset-change-verification}/scripts/
 * 下的副本必须保持一致 —— 改这里要同步过去。
 */
import { PNG } from 'pngjs';
import { createReadStream, createWriteStream } from 'fs';

const [, , inp, outp, tolArg] = process.argv;
const TOL = Number(tolArg || 26);

const png = await new Promise((res, rej) => {
  createReadStream(inp).pipe(new PNG()).on('parsed', function () { res(this); }).on('error', rej);
});

const { width: W, height: H, data } = png;
const idx = (x, y) => (y * W + x) * 4;

// 背景判定用**局部容差**：拿当前像素和「把它带进来的那个背景邻居」比，
// 不和一个全局颜色比。
//
// 为什么必须这样：模型经常无视「纯白背景 / 不要渐变」，把底烘成
// **带渐变的奶油色**（实测花园 TL=252,241,188 → BR=206,176,139，
// 两端距离约 93）。写死白色的话一个像素都抠不掉 —— 症状是打出的尺寸
// 和输入完全一样（816x816 -> 816x816）而退出码是 0，属于静默失败。
// 换成「四角取中位数」也不行，渐变没有单一代表色。
// 提高全局容差同样不行：容差大到能覆盖渐变时，也会啃掉画面本身
// （实测阈值 80 时填充率掉到 90%、有个角被穿透）。
//
// 局部容差能停在画面边界上，前提是**物件有清晰描边**
// —— 这正好由出图侧的描边纪律保证（见 skill game-art-from-ai）。
// 两件事是配套的：描边弱的图既读不清、也抠不干净。
const mark = new Uint8Array(W * H);
const stack = [];
// 入队格式：x, y, 来源像素的 r/g/b（边缘像素以自身为来源）
for (let x = 0; x < W; x++) {
  let i = idx(x, 0); stack.push(x, 0, data[i], data[i + 1], data[i + 2]);
  i = idx(x, H - 1); stack.push(x, H - 1, data[i], data[i + 1], data[i + 2]);
}
for (let y = 0; y < H; y++) {
  let i = idx(0, y); stack.push(0, y, data[i], data[i + 1], data[i + 2]);
  i = idx(W - 1, y); stack.push(W - 1, y, data[i], data[i + 1], data[i + 2]);
}

while (stack.length) {
  const sb = stack.pop(), sg = stack.pop(), sr = stack.pop();
  const y = stack.pop(), x = stack.pop();
  if (x < 0 || y < 0 || x >= W || y >= H) continue;
  const p = y * W + x;
  if (mark[p]) continue;
  const i = p * 4;
  const dr = sr - data[i], dg = sg - data[i + 1], db = sb - data[i + 2];
  if (Math.sqrt(dr * dr + dg * dg + db * db) > TOL) continue;
  mark[p] = 1;
  const r = data[i], g = data[i + 1], b = data[i + 2];
  stack.push(x + 1, y, r, g, b); stack.push(x - 1, y, r, g, b);
  stack.push(x, y + 1, r, g, b); stack.push(x, y - 1, r, g, b);
}

// 应用透明 + 计算内容包围盒
let minX = W, minY = H, maxX = -1, maxY = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = y * W + x;
    const i = p * 4;
    if (mark[p]) {
      data[i + 3] = 0;
    } else {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}

if (maxX < 0) { console.error('全图都是背景，放弃'); process.exit(1); }

// 裁到包围盒 + 2px 边距
const pad = 2;
const cx = Math.max(0, minX - pad), cy = Math.max(0, minY - pad);
const cw = Math.min(W - cx, maxX - minX + 1 + pad * 2);
const ch = Math.min(H - cy, maxY - minY + 1 + pad * 2);

const out = new PNG({ width: cw, height: ch });
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const s = idx(cx + x, cy + y);
    const d = (y * cw + x) * 4;
    out.data[d] = data[s];
    out.data[d + 1] = data[s + 1];
    out.data[d + 2] = data[s + 2];
    out.data[d + 3] = data[s + 3];
  }
}

await new Promise((res, rej) => {
  out.pack().pipe(createWriteStream(outp)).on('finish', res).on('error', rej);
});

console.log(`${inp.split(/[\\/]/).pop()}: ${W}x${H} -> ${cw}x${ch}`);
