/**
 * 生成道具障碍遮罩：读 assets/resources/map/{props,alcoves}/*.png 的 alpha，
 * 降采样成低分辨率 0/1 网格，写成 TS 数据模块 assets/scripts/ui/mapPropMasks.ts。
 *
 * 为什么离线生成 + TS 数据：运行时读 GPU 纹理像素在 Cocos 里不可靠（Texture2D
 * 默认不可读），而写成 TS 直接 import 就没有异步/纹理可读性的坑。运营往目录里
 * 丢新道具图后，跑一次这个脚本（可挂进构建流程）即可，寻路障碍自动精准、零手配。
 *
 * 用法（在 .build/ 下跑，依赖 pngjs 装在 .build/node_modules）：
 *   node scripts/gen-prop-masks.mjs
 */
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('..');
const DIRS = [
  path.join(ROOT, 'assets/resources/map/props'),
  path.join(ROOT, 'assets/resources/map/alcoves'),
];
const OUT = path.join(ROOT, 'assets/scripts/ui/mapPropMasks.ts');

// 遮罩分辨率：列 × 行。道具最大不到 200px，20×24 够精细又省体积。
const COLS = 20;
const ROWS = 24;
// alpha 阈值：超过才算实体
const ALPHA = 40;
// 每个降采样格里，实体像素占比超过这个才标 1（去掉稀疏的抗锯齿边缘）
const FILL = 0.18;

function maskOf(png) {
  const { width: W, height: H, data } = png;
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    let bits = '';
    for (let c = 0; c < COLS; c++) {
      // 该降采样格对应的原图像素范围
      const x0 = Math.floor((c / COLS) * W), x1 = Math.max(x0 + 1, Math.floor(((c + 1) / COLS) * W));
      const y0 = Math.floor((r / ROWS) * H), y1 = Math.max(y0 + 1, Math.floor(((r + 1) / ROWS) * H));
      let opaque = 0, total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          total++;
          if (data[(y * W + x) * 4 + 3] >= ALPHA) opaque++;
        }
      }
      bits += (total > 0 && opaque / total >= FILL) ? '1' : '0';
    }
    rows.push(bits); // rows[0] = 图最上面一行
  }
  return rows;
}

const entries = {};
for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.png')) continue;
    const name = f.replace(/\.png$/, ''); // e.g. prop_tower / alcove_care
    const png = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
    entries[name] = maskOf(png);
  }
}

const names = Object.keys(entries).sort();
let ts = `/**
 * 道具障碍遮罩（**自动生成，勿手改**）。由 .build/scripts/gen-prop-masks.mjs 从
 * 道具图的 alpha 降采样得到：'1'=实体、'0'=透明，rows[0] 是图的最上面一行。
 * 寻路（mapPathfind）按它标障碍，猫绕开道具的**真实形状**。
 * 加了新道具图后重跑生成脚本即可。分辨率 ${COLS}×${ROWS}。
 */

export interface PropMask { cols: number; rows: string[]; }

export const PROP_MASK_COLS = ${COLS};
export const PROP_MASK_ROWS = ${ROWS};

export const PROP_MASKS: Record<string, PropMask> = {
`;
for (const name of names) {
  const rows = entries[name].map((b) => `'${b}'`).join(', ');
  ts += `  '${name}': { cols: ${COLS}, rows: [${rows}] },\n`;
}
ts += `};\n`;

fs.writeFileSync(OUT, ts);
console.log(`wrote ${OUT}: ${names.length} masks (${COLS}x${ROWS})`);
console.log(names.join(', '));
