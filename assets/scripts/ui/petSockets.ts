/**
 * 换装挂点。
 *
 * 配饰不是合进模型的，是运行时按 slot 挂到骨骼上的（docs/06 §5.5）。
 * 模型里预留了两根不蒙皮的空骨骼 socket_hat / socket_neck，
 * 这里负责把它们接进 Cocos 的 Socket 系统，并把配饰节点挂上去。
 *
 * 前端按**名字**查找骨骼，拼错就是静默挂不上——所以这里查不到一律返回 null
 * 并打日志，不要让它悄无声息地失败。
 */

import { Node, Layers, SkeletalAnimation, SkinnedMeshRenderer } from 'cc';

/** 遮挡规则：戴上某件配饰要藏起宠物的哪些部位（docs/06 §5.5）。 */
export const ACCESSORY_HIDES: Record<string, string[]> = {
  acc_cap: ['part_ears'],
  acc_scarf: ['part_neck'],
  acc_bandana: ['part_neck'],
  acc_crown: [],
};

/**
 * 骨骼在 Socket 里用的是完整路径（形如 `Armature/root/hips/.../socket_hat`），
 * 而美术和文档只约定了末段的名字。这里按后缀反查出完整路径。
 */
export function findSocketPath(petRoot: Node, boneName: string): string | null {
  const smr = petRoot.getComponentInChildren(SkinnedMeshRenderer);
  const joints = smr && smr.skeleton ? smr.skeleton.joints : null;
  if (!joints) return null;

  const suffix = '/' + boneName;
  for (const path of joints) {
    if (path === boneName || path.endsWith(suffix)) return path;
  }
  return null;
}

/**
 * 建一个跟随指定骨骼的节点，配饰挂在它下面即可。
 *
 * 返回 null 表示骨骼不存在——通常是模型没按规范预留挂点，
 * 或者名字拼错了。调用方应当据此降级，而不是继续往下走。
 */
export function createSocketNode(
  petRoot: Node,
  anim: SkeletalAnimation,
  boneName: string,
): Node | null {
  const path = findSocketPath(petRoot, boneName);
  if (!path) {
    console.warn(`[petSockets] 模型里没有挂点骨骼 ${boneName}，配饰无法挂载`);
    return null;
  }

  // 预烘焙模式下骨骼矩阵被烤进贴图，Socket 拿不到实时变换，配饰就不会跟着骨骼走。
  anim.useBakedAnimation = false;

  const target = new Node(boneName);
  target.layer = Layers.Enum.DEFAULT;
  target.parent = petRoot;

  const socket = new SkeletalAnimation.Socket(path, target);
  anim.sockets = anim.sockets.concat([socket]);
  return target;
}

/** 按配饰的遮挡声明隐藏宠物部位；传空数组即恢复全部显示。 */
export function applyOcclusion(petRoot: Node, hiddenParts: string[]) {
  for (const part of ['part_ears', 'part_neck']) {
    const node = petRoot.getChildByName(part) || findDescendant(petRoot, part);
    if (node) node.active = hiddenParts.indexOf(part) < 0;
  }
}

function findDescendant(root: Node, name: string): Node | null {
  for (const child of root.children) {
    if (child.name === name) return child;
    const hit = findDescendant(child, name);
    if (hit) return hit;
  }
  return null;
}
