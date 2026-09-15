/**
 * 地图美术图的加载与落位。
 *
 * 图是 Lovart 生成 + 边缘泛洪抠底 + 裁边到 512 长边的 PNG（流程见 skill
 * `game-art-from-ai`），落在 `resources/map/alcoves/` 与 `resources/map/props/`。
 *
 * 两条纪律：
 *
 * 1. **尺寸直接读 `frame.rect`，用 `SizeMode.CUSTOM` 显式 setContentSize。**
 *    赋值 spriteFrame 之后立刻读 `UITransform.height` 是错的 —— 那一帧组件尺寸
 *    还没更新，算出来的 scale 会让图忽大忽小或飘在半空。
 * 2. **加载失败不补画、也不静默。** 代码绘制的结构本来就在图的下面，
 *    图没到货时那一层仍然出画面；这里只打一条 warn，方便排查。
 */

import { Node, Sprite, SpriteFrame, UITransform, resources } from 'cc';
import { makeNode } from './widgets';

/** 落位方式：图的哪个位置对齐到给定坐标 */
export type Anchor = 'center' | 'bottom';

export interface PlaceOpts {
  /** 目标框，图等比缩放到能塞进这个框 */
  w: number;
  h: number;
  /** 对齐点坐标 */
  x: number;
  y: number;
  anchor?: Anchor;
  /** 允许放大到超过原始尺寸。默认 false —— 放大会糊 */
  allowUpscale?: boolean;
}

/**
 * 异步加载一张图并挂到 parent 上。
 *
 * `parent` 为空或已销毁时直接返回，所以调用方不用自己判 disposed
 * （地图切换很快，回调回来时节点可能已经没了）。
 */
export function placeArt(
  parent: Node | null,
  path: string,
  opts: PlaceOpts,
  onDone?: (node: Node | null) => void,
): void {
  if (!parent || !parent.isValid) {
    if (onDone) onDone(null);
    return;
  }

  resources.load(`${path}/spriteFrame`, SpriteFrame, (err, frame) => {
    if (!parent || !parent.isValid) {
      if (onDone) onDone(null);
      return;
    }
    if (err || !frame) {
      console.warn(`[mapArt] ${path} 加载失败，该处保持代码绘制`, err);
      if (onDone) onDone(null);
      return;
    }
    // 挂载必须**在 if 之外**。曾写成 `if (onDone) onDone(mount(...))`，
    // 而所有调用方都不传回调 → mount 从来没执行过：图加载成功、回调也回来了，
    // 但 SpriteLayer 一个子节点都没有，且没有任何报错。
    // 这种「成功路径静默失败」查了整整一轮，靠打印子节点数才定位到。
    const node = mount(parent, frame as SpriteFrame, opts);
    if (onDone) onDone(node);
  });
}

/** 同步挂载（frame 已在手上时用） */
export function mount(parent: Node, frame: SpriteFrame, opts: PlaceOpts): Node {
  const rect = frame.rect;
  const srcW = rect.width || 512;
  const srcH = rect.height || 512;

  let scale = Math.min(opts.w / srcW, opts.h / srcH);
  if (!opts.allowUpscale) scale = Math.min(scale, 1);
  const w = srcW * scale;
  const h = srcH * scale;

  const node = makeNode('art', parent, w, h);
  const s = node.addComponent(Sprite);
  s.sizeMode = Sprite.SizeMode.CUSTOM;
  s.type = Sprite.Type.SIMPLE;
  s.spriteFrame = frame;
  const tr = node.getComponent(UITransform);
  if (tr) tr.setContentSize(w, h);

  const cy = opts.anchor === 'bottom' ? opts.y + h / 2 : opts.y;
  node.setPosition(opts.x, cy, 0);
  return node;
}
