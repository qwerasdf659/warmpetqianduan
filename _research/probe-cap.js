// 校验配饰挂载结果，并按遮挡规则隐藏耳朵。
// 用法：node _research/mcp-call.mjs --eval _research/probe-cap.js

const scene = cc.director.getScene();

function findByName(node, name) {
  if (node.name === name) return node;
  for (const child of node.children) {
    const hit = findByName(child, name);
    if (hit) return hit;
  }
  return null;
}

const pet = findByName(scene, 'pet_dog');
if (!pet) return { error: '场景里没有 pet_dog' };

const socket = findByName(pet, 'socket_hat');
const cap = socket && socket.children.find((c) => c.name === 'acc_cap');
if (!cap) return { error: '帽子没有挂在 socket_hat 下' };

// 配饰按「原点在挂点接触面中心」建模，局部变换归零才落在正确位置。
// setParent 保留世界变换，会把局部坐标反算成偏移量，配饰就留在原地了。
cap.setPosition(cc.Vec3.ZERO);
cap.setRotation(cc.Quat.IDENTITY);
cap.setScale(cc.Vec3.ONE);

const v = (p) => [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)];

// acc_cap 的遮挡声明是隐藏耳朵（docs/06 §5.5）
const ears = findByName(pet, 'part_ears');
if (ears) ears.active = false;

// 换装要求实时蒙皮，预烘焙模式下骨骼矩阵被烤进贴图，挂点拿不到实时变换
const anim = pet.getComponent(cc.SkeletalAnimation);
if (anim) anim.useBakedAnimation = false;

return {
  挂点世界坐标: v(socket.worldPosition),
  帽子世界坐标: v(cap.worldPosition),
  帽子局部坐标: v(cap.position),
  两者重合: v(socket.worldPosition).join() === v(cap.worldPosition).join(),
  耳朵已隐藏: ears ? !ears.active : '找不到 part_ears',
  预烘焙已关闭: anim ? !anim.useBakedAnimation : '没有 SkeletalAnimation',
};
