/**
 * 从 Cocos 的 library/ 导入产物里读出骨骼列表。
 *
 * 用来验证 FBX 导入后骨骼名和数量有没有变——比在编辑器里逐个点开快。
 * 用法：node _research/read-cocos-skeleton.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'library');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.json')) yield p;
  }
}

// 编辑器重建资源库时会整个删掉 library/，这时候等它导完再跑。
if (!fs.existsSync(LIB)) {
  console.log('library/ 不存在——Cocos 正在重建资源库，等导入完成后重跑。');
  process.exit(0);
}

let skeletons = 0;
let bounds = 0;
const seen = new Set();

for (const file of walk(LIB)) {
  const raw = fs.readFileSync(file, 'utf8');

  // 网格资源里存了 Cocos 空间下的包围盒，用来判断导入后的朝向和尺寸。
  if (raw.includes('minPosition')) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    for (const box of parsed ? findBounds(parsed) : []) {
      bounds++;
      const v = (p) => `[${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)}]`;
      console.log('--- 包围盒 ' + path.basename(file));
      console.log('    min(x,y,z) = ' + v(box.min));
      console.log('    max(x,y,z) = ' + v(box.max));
      console.log('    尺寸        = ' +
        `x ${(box.max.x - box.min.x).toFixed(4)}  ` +
        `y ${(box.max.y - box.min.y).toFixed(4)}  ` +
        `z ${(box.max.z - box.min.z).toFixed(4)}`);
    }
  }

  if (!raw.includes('socket_hat')) continue;
  let data;
  try { data = JSON.parse(raw); } catch { continue; }
  const joints = collectJoints(data);
  if (!joints) continue;

  const key = joints.join('|');
  if (seen.has(key)) continue;
  seen.add(key);

  skeletons++;
  console.log('=== 骨骼 ' + path.relative(ROOT, file));
  console.log('    joints = ' + joints.length);
  joints.forEach((n, i) => console.log('    ' + String(i + 1).padStart(3) + '  ' + n));
}

if (!skeletons) console.log('没找到带 joints 的资源，FBX 可能还没导入完。');
if (!bounds) console.log('没找到网格包围盒。');

/** 深度优先收集所有 minPosition / maxPosition 成对出现的地方。 */
function findBounds(node, depth = 0, out = []) {
  if (depth > 14 || node === null || typeof node !== 'object') return out;
  if (!Array.isArray(node) && node.minPosition && node.maxPosition) {
    out.push({ min: node.minPosition, max: node.maxPosition });
  }
  for (const key of Object.keys(node)) findBounds(node[key], depth + 1, out);
  return out;
}

/** 序列化格式各版本不同，直接深度优先找第一个看起来像骨骼名数组的字段。 */
function collectJoints(node, depth = 0) {
  if (depth > 12 || node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    const allStrings = node.length > 4 && node.every((x) => typeof x === 'string');
    if (allStrings && node.some((x) => x.includes('socket_hat'))) return node;
    for (const item of node) {
      const hit = collectJoints(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of Object.keys(node)) {
    const hit = collectJoints(node[key], depth + 1);
    if (hit) return hit;
  }
  return null;
}
