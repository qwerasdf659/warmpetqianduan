// 查 resources 下模型子资源的运行时加载路径，避免靠猜。
// 用法：node _research/mcp-call.mjs --eval _research/probe-respath.js

const info = await Editor.Message.request(
  'asset-db',
  'query-asset-info',
  'db://assets/resources/models/pet_dog.glb',
);

const subs = [];
for (const [key, sub] of Object.entries(info.subAssets || {})) {
  subs.push({
    键: key,
    名字: sub.name,
    类型: sub.type,
    url: sub.url,
    uuid: sub.uuid,
    // resources.load 用的是相对 resources/ 的路径，去掉前缀和扩展名
    运行时路径: sub.url
      ? sub.url.replace(/^db:\/\/assets\/resources\//, '').replace(/\.glb/, '')
      : null,
  });
}

return {
  主资源: { url: info.url, uuid: info.uuid, type: info.type },
  子资源: subs,
};
