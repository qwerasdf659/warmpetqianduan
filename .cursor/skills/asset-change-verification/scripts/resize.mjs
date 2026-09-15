/** 等比缩放 PNG 到指定最大边（保持透明），控制包体 */
import { PNG } from 'pngjs';
import { createReadStream, createWriteStream } from 'fs';

const [, , inp, outp, maxArg] = process.argv;
const MAX = Number(maxArg || 512);

const src = await new Promise((res, rej) => {
  createReadStream(inp).pipe(new PNG()).on('parsed', function () { res(this); }).on('error', rej);
});

const scale = Math.min(1, MAX / Math.max(src.width, src.height));
const W = Math.max(1, Math.round(src.width * scale));
const H = Math.max(1, Math.round(src.height * scale));
const dst = new PNG({ width: W, height: H });

// 面积平均降采样（box filter），对扁平卡通图足够且不会糊
const sx = src.width / W;
const sy = src.height / H;
for (let y = 0; y < H; y++) {
  const y0 = Math.floor(y * sy), y1 = Math.min(src.height, Math.ceil((y + 1) * sy));
  for (let x = 0; x < W; x++) {
    const x0 = Math.floor(x * sx), x1 = Math.min(src.width, Math.ceil((x + 1) * sx));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * src.width + xx) * 4;
        const av = src.data[i + 3] / 255;
        // 预乘后再平均，避免透明像素的 RGB 污染边缘
        r += src.data[i] * av; g += src.data[i + 1] * av; b += src.data[i + 2] * av;
        a += src.data[i + 3];
        n++;
      }
    }
    const d = (y * W + x) * 4;
    const aa = a / n;
    const inv = aa > 0 ? 255 / aa : 0;
    dst.data[d] = Math.min(255, Math.round((r / n) * inv));
    dst.data[d + 1] = Math.min(255, Math.round((g / n) * inv));
    dst.data[d + 2] = Math.min(255, Math.round((b / n) * inv));
    dst.data[d + 3] = Math.round(aa);
  }
}

await new Promise((res, rej) => {
  dst.pack().pipe(createWriteStream(outp)).on('finish', res).on('error', rej);
});
console.log(`${inp.split(/[\\/]/).pop()}: ${src.width}x${src.height} -> ${W}x${H}`);
