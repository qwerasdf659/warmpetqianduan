/**
 * 确认新加的货币图标被导成了 sprite-frame。
 *
 * MainView 用 `resources.load('icons/icon_coin/spriteFrame')` 取它。
 * 图片的导入类型如果是默认的 texture，那个子资源就不存在，
 * 运行时只会打一条警告然后药丸里没有图标——不会报错，很容易漏掉。
 */
const root = 'db://assets/resources/icons';
await Editor.Message.request('asset-db', 'refresh-asset', root);
await new Promise((r) => setTimeout(r, 5000));

const assets = await Editor.Message.request('asset-db', 'query-assets', {
  pattern: root + '/**',
});

const wanted = ['icon_coin', 'icon_point', 'icon_feed'];
const report = {};
for (const name of wanted) {
  const hits = assets.filter((a) => (a.url || '').includes(name));
  report[name] = hits.map((a) => `${a.name} [${a.type}]`).sort();
}
return report;
