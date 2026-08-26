/**
 * 挂点自检。挂到场景里的 pet_dog 节点上，运行预览即可。
 *
 * 它回答一个问题：模型里那两根不蒙皮的空骨骼，能不能真的驱动挂在上面的配饰。
 * 整个换装系统（docs/06 §5.5）都压在这个能力上，所以在写换装逻辑之前先验它。
 *
 * 验完就可以删掉，不是正式功能。
 */

import { _decorator, Component, Node, Layers, Color, Material, MeshRenderer, Vec3, primitives, utils, SkeletalAnimation, SkinnedMeshRenderer } from 'cc';
import { createSocketNode, findSocketPath } from './petSockets';

const { ccclass } = _decorator;

const PROBE_COLORS: Record<string, Color> = {
  socket_hat: new Color(83, 121, 165, 255),
  socket_neck: new Color(216, 94, 80, 255),
};

@ccclass('SocketProbe')
export class SocketProbe extends Component {
  start() {
    const pet = this.node;

    const smr = pet.getComponentInChildren(SkinnedMeshRenderer);
    const joints = smr && smr.skeleton ? smr.skeleton.joints : null;
    console.log(`[SocketProbe] 骨骼数 = ${joints ? joints.length : '找不到 skeleton'}`);

    let anim = pet.getComponent(SkeletalAnimation);
    if (!anim) anim = pet.addComponent(SkeletalAnimation);

    for (const boneName of ['socket_hat', 'socket_neck']) {
      const path = findSocketPath(pet, boneName);
      console.log(`[SocketProbe] ${boneName} -> ${path || '未找到'}`);

      const target = createSocketNode(pet, anim, boneName);
      if (!target) continue;

      this.addProbeBox(target, boneName);
    }
  }

  /** 挂一个小方块当占位配饰。位置正确说明挂点可用，跟着骨骼动说明实时蒙皮生效。 */
  private addProbeBox(parent: Node, boneName: string) {
    const node = new Node(`probe_${boneName}`);
    node.layer = Layers.Enum.DEFAULT;
    node.parent = parent;
    node.setScale(new Vec3(0.18, 0.18, 0.18));

    const mat = new Material();
    mat.initialize({ effectName: 'builtin-standard' });
    mat.setProperty('albedo', PROBE_COLORS[boneName]);
    mat.setProperty('roughness', 0.9);
    mat.setProperty('metallic', 0);

    const mr = node.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(primitives.box({ width: 1, height: 1, length: 1 }));
    mr.material = mat;
  }
}
