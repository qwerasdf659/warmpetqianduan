/** 打印一批 PNG 的宽高与不透明像素包围盒占比，用来判断是否还有大片空白边。 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const dir = process.argv[2];
for (const f of readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.png'))) {
  const png = PNG.sync.read(readFileSync(join(dir, f)));
  let minX = png.width, minY = png.height, maxX = -1, maxY = -1, opaque = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.data[(png.width * y + x) * 4 + 3] > 8) {
        opaque++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const fill = ((opaque / (png.width * png.height)) * 100).toFixed(1);
  console.log(`${f}\t${png.width}x${png.height}\tbbox=${bw}x${bh}\t不透明=${fill}%`);
}
