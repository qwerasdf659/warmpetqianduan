/**
 * 验证手写的 pet_toon.mtl 被 Cocos 正确导入了。
 *
 * 要确认三件事：
 *   1. effect 指向 builtin-toon（uuid 对不对）
 *   2. **pass 数量是 5**——描边 pass 是 `switch: USE_OUTLINE_PASS` 控制的，
 *      宏没生效的话它会被整个跳过，材质只有 4 个 pass，而且不会有任何报错
 *   3. USE_BASE_COLOR_MAP 在主 pass 上打开了（宏名和 builtin-standard 不同，
 *      写成 USE_ALBEDO_MAP 的话贴图设了也永远不采样）
 */
const fs = require('fs');

const url = 'db://assets/resources/materials/pet_toon.mtl';
await Editor.Message.request('asset-db', 'refresh-asset', url);
await new Promise((r) => setTimeout(r, 4000));

const info = await Editor.Message.request('asset-db', 'query-asset-info', url);
if (!info) return { error: 'material not found in asset-db' };

const lib = info.library ? info.library['.json'] : null;
if (!lib || !fs.existsSync(lib)) return { error: 'no library json', info };

const raw = JSON.parse(fs.readFileSync(lib, 'utf8'));
return {
  uuid: info.uuid,
  effect: raw._effectAsset ? raw._effectAsset.__uuid__ : null,
  techIdx: raw._techIdx,
  passCount: Array.isArray(raw._defines) ? raw._defines.length : null,
  defines: raw._defines,
};
