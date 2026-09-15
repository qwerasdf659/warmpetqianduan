/**
 * 从 Resource Han Rounded 的 .7z 里取出需要的字重。
 *
 * 为什么用 node 库而不是系统 7-Zip：本机没装 7-Zip，而 Windows 自带的 bsdtar
 * 报 `LZMA codec is unsupported`（.7z 的 LZMA 压缩它解不了）。
 * `7zip-min` 自带二进制，不用改系统环境。
 */
import { list, unpack } from '7zip-min';
import path from 'node:path';
import { promisify } from 'node:util';

const listP = promisify(list);
const unpackP = promisify(unpack);

const archive = path.resolve('font/RHR-CN.7z');
const dest = path.resolve('font/rhr');

const entries = await listP(archive);
const fonts = entries.filter((e) => /\.(ttf|otf)$/i.test(e.name));
console.log(`压缩包内字体文件 ${fonts.length} 个:`);
for (const f of fonts) {
  console.log(`  ${(f.size / 1024 / 1024).toFixed(1)}MB  ${f.name}`);
}
const lic = entries.filter((e) => /license|OFL/i.test(e.name));
console.log(`许可证文件: ${lic.map((l) => l.name).join(', ') || '(未找到，需另取)'}`);

console.log(`\n解包到 ${dest} ...`);
await unpackP(archive, dest);
console.log('done');
