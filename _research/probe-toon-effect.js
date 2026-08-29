/**
 * 取 builtin-toon 的 uuid，并看一眼引擎内置 effect 在资源库里的 url 形式。
 *
 * 需要它是因为材质资源（.mtl）里通过 uuid 引用 effect。
 * 而且必须**建一个材质资源**去引用它：运行时只有被资源引用到的 effect 才会
 * 打进包，光在代码里 `effectName: 'builtin-toon'` 拿不到（见 client-cocos 规则）。
 */
const names = ['builtin-toon', 'builtin-standard', 'builtin-unlit'];
const out = {};

for (const name of names) {
  const url = `db://internal/effects/${name}.effect`;
  let uuid = null;
  try {
    uuid = await Editor.Message.request('asset-db', 'query-uuid', url);
  } catch (e) {
    uuid = 'ERR: ' + e.message;
  }
  out[name] = { url, uuid };
}

// 顺带看看内置 effect 目录里实际有什么，万一 url 形式不对
let listed = [];
try {
  const assets = await Editor.Message.request('asset-db', 'query-assets', {
    pattern: 'db://internal/effects/*',
  });
  listed = assets.map((a) => `${a.name} :: ${a.url}`).slice(0, 40);
} catch (e) {
  listed = ['ERR: ' + e.message];
}

return { effects: out, sample: listed };
