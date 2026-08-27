// 在编辑器的场景进程里跑，验证挂点骨骼是不是真实节点、位置对不对。
// 用法：node _research/mcp-call.mjs --eval _research/probe-sockets.js

const scene = cc.director.getScene();

function findByName(node, name) {
  if (node.name === name) return node;
  for (const child of node.children) {
    const hit = findByName(child, name);
    if (hit) return hit;
  }
  return null;
}

let pet = findByName(scene, 'pet_dog');
if (!pet) return { error: '场景里没有 pet_dog 节点' };

// 骨骼在 glTF 导入后是不是真实节点，决定了配饰能不能直接 parent 上去，
// 还是必须走 SkeletalAnimation 的 Socket 系统。
const socketNodes = {};
for (const boneName of ['socket_hat', 'socket_neck', 'head', 'part_ears', 'part_neck']) {
  const node = findByName(pet, boneName);
  socketNodes[boneName] = node
    ? {
        存在: true,
        世界坐标: [
          +node.worldPosition.x.toFixed(3),
          +node.worldPosition.y.toFixed(3),
          +node.worldPosition.z.toFixed(3),
        ],
      }
    : { 存在: false };
}

const smr = pet.getComponentInChildren(cc.SkinnedMeshRenderer);
const anim = pet.getComponent(cc.SkeletalAnimation);

// 统计节点树里有多少个关节节点，和 skeleton 资源里的 joints 数对照
let nodeCount = 0;
(function count(n) {
  nodeCount++;
  n.children.forEach(count);
})(pet);

return {
  宠物节点: pet.name,
  子节点总数: nodeCount,
  骨骼资源关节数: smr && smr.skeleton ? smr.skeleton.joints.length : null,
  有SkeletalAnimation: !!anim,
  预烘焙: anim ? anim.useBakedAnimation : null,
  挂点与部件: socketNodes,
};
