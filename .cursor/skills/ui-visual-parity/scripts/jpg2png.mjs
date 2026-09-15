/** JPEG → PNG（pngjs 读不了 jpg）。用无头浏览器的 canvas 转，不引新依赖。 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const browser = await chromium.launch();
const page = await browser.newPage();
for (let i = 2; i < process.argv.length; i += 2) {
  const src = process.argv[i];
  const dst = process.argv[i + 1];
  const b64 = readFileSync(src).toString('base64');
  const out = await page.evaluate(async (d) => {
    const img = new Image();
    img.src = 'data:image/jpeg;base64,' + d;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/png').split(',')[1];
  }, b64);
  writeFileSync(dst, Buffer.from(out, 'base64'));
  console.log(`${dst} ok`);
}
await browser.close();
