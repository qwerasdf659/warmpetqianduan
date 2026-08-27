// 清掉场景里所有旧的 pet_dog 实例，只留最新的一个，并报告它的动画 clip。
// clip 名传错是静默不播，所以要拿到运行时的真实值。
// 用法：node _research/mcp-call.mjs --eval _research/probe-clip.js

const scene = cc.director.getScene();

function collect(node, name, out) {
  if (node.name === name) out.push(node);
  for (const child of node.children) collect(child, name, out);
  return out;
}

const all = collect(scene, 'pet_dog', []);
if (all.length === 0) return { error: '场景里没有 pet_dog' };

// 最后实例化的那个才是带动画的版本，其余是历史遗留
const keep = all[all.length - 1];
for (const node of all) {
  if (node !== keep) node.destroy();
}

const anim = keep.getComponent(cc.SkeletalAnimation) || keep.getComponentInChildren(cc.SkeletalAnimation);

return {
  清理掉的旧实例: all.length - 1,
  有SkeletalAnimation: !!anim,
  clip数量: anim ? anim.clips.length : null,
  clip名字: anim ? anim.clips.map((c) => (c ? c.name : null)) : null,
  默认clip: anim && anim.defaultClip ? anim.defaultClip.name : null,
  时长: anim ? anim.clips.map((c) => (c ? +c.duration.toFixed(3) : null)) : null,
};
