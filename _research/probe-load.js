// 验证 PetStage.ts 里用的 resources.load 路径真的能加载到。
// 路径写错时 resources.load 只是回调一个 error，界面上表现为宠物不出现，
// 很容易被误判成模型或相机的问题，所以单独验一次。
// 用法：node _research/mcp-call.mjs --eval _research/probe-load.js

function tryLoad(path, type) {
  return new Promise((resolve) => {
    cc.resources.load(path, type, (err, asset) => {
      resolve({
        路径: path,
        成功: !err && !!asset,
        错误: err ? String(err.message || err) : null,
        资源名: asset ? asset.name : null,
      });
    });
  });
}

const results = [];
results.push(await tryLoad('models/pet_dog/pet_dog', cc.Prefab));
results.push(await tryLoad('models/acc_cap/acc_cap', cc.Prefab));
return results;
