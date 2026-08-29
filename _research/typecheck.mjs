/**
 * 类型检查入口。
 *
 * Cocos 构建只转译不做类型检查——调用 `Graphics.arcTo` 这种「引擎根本没这个方法」
 * 的错误在构建期一声不吭，跑起来才半截白屏。这个脚本把那类问题提前到编译期。
 *
 * 跑法：
 *   node _research/typecheck.mjs
 *
 * 它做三件事：
 *   1. 找到本机 Creator 里的 cc.d.ts（以前这个路径是硬编码在 tsconfig.check.json
 *      里的绝对路径，换台机器就跑不起来）
 *   2. 生成 tsconfig.check.local.json（gitignore 掉，只有 files 一项是机器相关的）
 *   3. 调 tsc
 *
 * 装在别处：
 *   $env:WARMPET_COCOS = 'D:\CocosCreator\3.8.8'
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const manifest = JSON.parse(readFileSync(join(repoRoot, 'tools', 'toolchain.json'), 'utf8'));

/** cc.d.ts 相对 Creator 安装根目录的位置。3.8.x 都是这个。 */
const CC_DTS_REL = 'resources/resources/3d/engine/bin/.declarations/cc.d.ts';

function candidateRoots() {
  const spec = manifest.cocos;
  const out = [];

  // 覆盖变量设错时要当场报错，不能悄悄回退到自动扫描——
  // 那样用户以为在查 D:\ 那份，实际查的是 C:\ 那份，
  // 结果对不上还找不到原因。
  const override = process.env[spec.envOverride];
  if (override) {
    if (!existsSync(join(override, CC_DTS_REL))) {
      console.error(
        [
          `${spec.envOverride} 指向 '${override}'，但那里没有 cc.d.ts。`,
          `期望的位置：${join(override, CC_DTS_REL)}`,
          '',
          '（不回退到自动扫描：那样你以为在查这个 Creator，实际查的是另一个。）',
        ].join('\n')
      );
      process.exit(2);
    }
    return [override];
  }

  out.push(...spec.searchPaths);

  // 同一台机器上可能装了别的版本，按目录名兜底扫一遍
  const parent = 'C:/ProgramData/cocos/editors/Creator';
  if (existsSync(parent)) {
    for (const name of readdirSync(parent)) out.push(join(parent, name));
  }
  return [...new Set(out)];
}

function resolveCcDts() {
  const tried = [];
  for (const root of candidateRoots()) {
    const p = join(root, CC_DTS_REL);
    tried.push(p);
    if (existsSync(p)) return { root, ccDts: p };
  }
  console.error(
    [
      '找不到 cc.d.ts。类型检查需要 Creator 自带的那份引擎声明。',
      '',
      '（不要退回 temp/declarations——那个要在编辑器里手动生成，默认是空的，',
      '  引它会让检查静默通过，比报错更糟。）',
      '',
      '找过这些位置：',
      ...tried.map((p) => '  ' + p),
      '',
      `装在别处就设环境变量：$env:${manifest.cocos.envOverride} = 'D:\\CocosCreator\\3.8.8'`,
    ].join('\n')
  );
  process.exit(2);
}

const { root, ccDts } = resolveCcDts();

// 只把机器相关的那一项写进本地配置，其余全部继承 tsconfig.check.json。
// 两个文件同目录，所以 base 里的 include 相对路径不用改。
const localPath = join(here, 'tsconfig.check.local.json');
writeFileSync(
  localPath,
  JSON.stringify(
    {
      '//': '由 _research/typecheck.mjs 生成，勿手改，勿进 git。',
      extends: './tsconfig.check.json',
      files: [ccDts.replace(/\\/g, '/')],
    },
    null,
    2
  ) + '\n',
  'utf8'
);

console.log(`[cocos] ${root}`);
console.log(`[tsc]   检查 assets/scripts/**/*.ts`);

// Windows 上必须 shell:true——较新的 Node 收紧了 spawn，直接拉 .cmd 会 EINVAL。
const res = spawnSync('npx', ['-y', '-p', 'typescript@5.6', 'tsc', '-p', localPath], {
  stdio: 'inherit',
  cwd: repoRoot,
  shell: process.platform === 'win32',
});

if (res.error) {
  console.error('调不起 npx：', res.error.message);
  process.exit(2);
}
if (res.status === 0) console.log('类型检查通过。');
process.exit(res.status ?? 1);
