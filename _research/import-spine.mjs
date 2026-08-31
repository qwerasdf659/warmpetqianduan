/**
 * 批量把素材包里的 Spine 骨骼导入 assets/resources/spine/。
 *
 * 处理两类来源：
 *   1) 站点/道具/特效：附送UI/<Name>.skel.txt + <Name>.atlas.txt + 贴图在同目录
 *   2) 互动家具：附送UI/spine/interactive furniture/<folder>/<Name>.skel.skel
 *      + <Name>.atlas.atlas，贴图在同名子目录里
 *
 * 每个目标落到 resources/spine/<san>/，skel 与 atlas 统一改名成 <san>.skel / <san>.atlas
 * （Cocos 按同名配对），atlas 内部引用的贴图名保持不变、原样拷进去。
 *
 * 用法：node _research/import-spine.mjs "<素材包根>" "<resources/spine 目标目录>"
 */
import fs from 'fs';
import path from 'path';

const root = process.argv[2];
const destRoot = process.argv[3];
if (!root || !destRoot) {
  console.error('用法: node import-spine.mjs <packRoot> <resSpineDir>');
  process.exit(1);
}

const uiDir = path.join(root, '附送UI');
const furnDir = path.join(uiDir, 'spine', 'interactive furniture');

/** 把带空格/括号的名字规整成资源安全名 */
function san(name) {
  return name.replace(/[()\s]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

/** 递归列出目录下所有文件 */
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** 从 atlas 文本里取出所有贴图页文件名（顶格、以图片后缀结尾、不含冒号的行） */
function atlasPages(text) {
  const pages = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (raw[0] === ' ' || raw[0] === '\t') continue; // 缩进行是 region 属性
    if (line.includes(':')) continue;
    if (/\.(png|jpg|jpeg|webp)$/i.test(line)) pages.push(line);
  }
  return pages;
}

const jobs = [];

// 1) 站点/道具/特效（二进制 .skel.txt）
if (fs.existsSync(uiDir)) {
  for (const f of fs.readdirSync(uiDir)) {
    if (f.endsWith('.skel.txt')) {
      const base = f.slice(0, -'.skel.txt'.length);
      jobs.push({
        base,
        skel: path.join(uiDir, f),
        skelExt: 'skel',
        atlas: path.join(uiDir, base + '.atlas.txt'),
        searchRoot: uiDir,
      });
    }
  }
  // 1b) JSON 骨骼（<Name>.txt，内容以 { 开头，且存在同名 .atlas.txt）
  for (const f of fs.readdirSync(uiDir)) {
    if (!f.endsWith('.txt')) continue;
    if (f.endsWith('.atlas.txt') || f.endsWith('.skel.txt')) continue;
    if (/translations|customFields/i.test(f)) continue;
    const base = f.slice(0, -'.txt'.length);
    const atlas = path.join(uiDir, base + '.atlas.txt');
    if (!fs.existsSync(atlas)) continue;
    const head = fs.readFileSync(path.join(uiDir, f), 'utf8').trimStart().slice(0, 1);
    if (head !== '{') continue;
    jobs.push({ base, skel: path.join(uiDir, f), skelExt: 'json', atlas, searchRoot: uiDir });
  }
}

// 2) 互动家具
if (fs.existsSync(furnDir)) {
  for (const sub of fs.readdirSync(furnDir)) {
    const subPath = path.join(furnDir, sub);
    if (!fs.statSync(subPath).isDirectory()) continue;
    for (const f of fs.readdirSync(subPath)) {
      if (f.endsWith('.skel.skel')) {
        const base = f.slice(0, -'.skel.skel'.length);
        jobs.push({
          base,
          skel: path.join(subPath, f),
          skelExt: 'skel',
          atlas: path.join(subPath, base + '.atlas.atlas'),
          searchRoot: subPath,
        });
      }
    }
  }
}

const ok = [];
const failed = [];

for (const job of jobs) {
  const name = san(job.base);
  try {
    if (!fs.existsSync(job.atlas)) throw new Error('缺 atlas');
    const atlasText = fs.readFileSync(job.atlas, 'utf8');
    const pages = atlasPages(atlasText);
    if (!pages.length) throw new Error('atlas 无贴图页');

    // 在 searchRoot 下递归找每个贴图页
    const allFiles = walk(job.searchRoot);
    const pngMap = {};
    for (const page of pages) {
      const hit = allFiles.find((p) => path.basename(p) === page);
      if (!hit) throw new Error(`缺贴图 ${page}`);
      pngMap[page] = hit;
    }

    const dest = path.join(destRoot, name);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(job.skel, path.join(dest, name + '.' + (job.skelExt || 'skel')));
    fs.copyFileSync(job.atlas, path.join(dest, name + '.atlas'));
    for (const [page, src] of Object.entries(pngMap)) {
      fs.copyFileSync(src, path.join(dest, page));
    }
    ok.push({ name, pages: pages.length });
  } catch (e) {
    failed.push({ name, reason: e.message });
  }
}

console.log('=== 导入成功 ===');
for (const o of ok) console.log(`  ${o.name}  (${o.pages} 页)`);
console.log(`\n=== 跳过/失败 ===`);
for (const f of failed) console.log(`  ${f.name}  — ${f.reason}`);
console.log(`\n合计: 成功 ${ok.length} / 失败 ${failed.length}`);
console.log('\nPROP_LIST 用:');
console.log(ok.map((o) => `'${o.name}/${o.name}'`).join(', '));
