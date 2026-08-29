/**
 * 查 Cocos 把两个物种的 GLB 导成了什么。
 *
 * 关键问题：贴图有没有接到 builtin-standard 的 albedoMap / normalMap 上、
 * USE_NORMAL_MAP 有没有打开，以及 prefab 子资源路径对不对——
 * PetStage 用 `resources.load('models/pet_cat/pet_cat')` 取的就是它。
 */
const fs = require('fs');

async function inspect(model) {
  const root = `db://assets/resources/models/${model}.glb`;
  await Editor.Message.request('asset-db', 'refresh-asset', root);
  await new Promise((r) => setTimeout(r, 5000));

  const assets = await Editor.Message.request('asset-db', 'query-assets', {
    pattern: root + '/**',
  });

  // 别写死材质名：外来模型的材质叫什么都有可能（这只猫叫 lambert2SG），
  // 按后缀找才通用。
  const mat = assets.find((a) => (a.name || '').endsWith('.material'));
  let material = null;
  if (mat) {
    const info = await Editor.Message.request('asset-db', 'query-asset-info', mat.uuid);
    const lib = info && info.library ? info.library['.json'] : null;
    if (lib && fs.existsSync(lib)) {
      const raw = JSON.parse(fs.readFileSync(lib, 'utf8'));
      const pass = raw._props ? raw._props[0] : null;
      material = {
        maps: Object.entries(pass || {})
          .filter(([, v]) => v && typeof v === 'object' && v.__uuid__)
          .map(([k]) => k),
        defines: raw._defines ? raw._defines[0] : null,
      };
    }
  }

  return {
    subAssets: assets.map((a) => a.name).sort(),
    hasPrefab: assets.some((a) => a.name === `${model}.prefab`),
    material,
  };
}

return { dog: await inspect('pet_dog'), cat: await inspect('pet_cat') };
