// 把截图的一块裁出来放大，用于肉眼确认「细节是否还留得住」。
// 用法: node crop-zoom.mjs <in.png> <out.png> <x> <y> <w> <h> [scale]
import { PNG } from 'pngjs';
import fs from 'fs';

const [, , inp, outp, xs, ys, ws, hs, ss] = process.argv;
const x0 = +xs, y0 = +ys, cw = +ws, ch = +hs, sc = +(ss || 3);

const src = PNG.sync.read(fs.readFileSync(inp));
const out = new PNG({ width: cw * sc, height: ch * sc });

for (let y = 0; y < ch * sc; y++) {
  for (let x = 0; x < cw * sc; x++) {
    const sx = Math.min(src.width - 1, x0 + Math.floor(x / sc));
    const sy = Math.min(src.height - 1, y0 + Math.floor(y / sc));
    const si = (sy * src.width + sx) * 4;
    const di = (y * out.width + x) * 4;
    for (let k = 0; k < 4; k++) out.data[di + k] = src.data[si + k];
  }
}
fs.writeFileSync(outp, PNG.sync.write(out));
console.log(`${outp} ${out.width}x${out.height} (源 ${src.width}x${src.height} 裁 ${cw}x${ch} @${sc}x)`);
