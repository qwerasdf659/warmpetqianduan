/**
 * 装修商店：网格列出家具静态立绘，点一件看大图预览。
 *
 * 素材来自素材包的家具切图（`resources/shop/furn` 136 张缩略图、
 * `resources/shop/preview` 21 张大图预览）。文件名保留原始编号 FURN_xxx，
 * 和 `resources/spine/FURN_*`（可放置的骨骼家具）是同一套编号，
 * 以后要「买了就能摆」靠这个编号对上。
 *
 * 现在是纯展示：没有价格、没有购买、没有库存——那些要后端接口，
 * 本文件只解决「把 136 张家具图变成可浏览的商店界面」。
 */

import { _decorator, Component, Node, Sprite, SpriteFrame, resources, Graphics, UITransform, EventTouch, Vec3, view } from 'cc';
import { makeNode, makeLabel, fillRoundRectRim, COLOR } from './widgets';
import { ModalPanel } from './ModalPanel';

const { ccclass } = _decorator;

const FURN_DIR = 'shop/furn';
const PREVIEW_DIR = 'shop/preview';

/** 网格：4 列，格子含间距 */
const COLS = 4;
const CELL_GAP = 8;
/** 缩略图在格子里的留白比例（1 = 撑满） */
const THUMB_FILL = 0.82;

@ccclass('ShopPanel')
export class ShopPanel extends Component {
  private modal: ModalPanel | null = null;
  private frames: SpriteFrame[] = [];
  /** 网格容器，拖动它实现滚动（不引入 ScrollView，省一层组件与预制体依赖） */
  private grid: Node | null = null;
  private gridMinY = 0;
  private gridMaxY = 0;
  private dragging = false;
  private lastTouchY = 0;

  public static open(parent: Node) {
    const host = new Node('ShopPanel');
    host.parent = parent;
    const comp = host.addComponent(ShopPanel);
    comp.build();
    return comp;
  }

  private build() {
    this.modal = ModalPanel.open(this.node, '装修商店');
    resources.loadDir(FURN_DIR, SpriteFrame, (err, frames) => {
      if (!this.node.isValid) return;
      if (err || !frames || !frames.length) {
        console.warn('[ShopPanel] 家具图加载失败', err);
        this.showEmpty();
        return;
      }
      this.frames = frames as SpriteFrame[];
      this.buildGrid();
    });
  }

  private showEmpty() {
    const body = this.modal && this.modal.body;
    if (!body) return;
    const tip = makeLabel('暂无商品', body, { size: 20, color: COLOR.dim, align: 'center' });
    tip.node.setPosition(0, 0, 0);
  }

  private buildGrid() {
    const modal = this.modal;
    if (!modal || !modal.body) return;
    const bodyW = modal.bodyW;
    const bodyH = modal.bodyH;

    const cell = (bodyW - CELL_GAP * (COLS - 1)) / COLS;
    const rows = Math.ceil(this.frames.length / COLS);
    const contentH = rows * (cell + CELL_GAP);

    // 可视窗口：用一个节点当裁剪参考（这里不做真裁剪，靠面板边界视觉遮挡），
    // 拖动范围按内容高度与可视高度差算。
    const grid = new Node('Grid');
    grid.parent = modal.body;
    grid.addComponent(UITransform);
    this.grid = grid;

    // 内容从可视区顶部往下排
    const top = bodyH / 2;
    this.frames.forEach((frame, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = -bodyW / 2 + cell / 2 + col * (cell + CELL_GAP);
      const y = top - cell / 2 - row * (cell + CELL_GAP);
      this.makeCell(grid, frame, x, y, cell);
    });

    // 拖动上限：内容比可视区高多少就能往上拖多少
    this.gridMinY = 0;
    this.gridMaxY = Math.max(0, contentH - bodyH);
    this.bindScroll(modal.body, bodyW, bodyH);
  }

  private makeCell(parent: Node, frame: SpriteFrame, x: number, y: number, cell: number) {
    const node = makeNode('Cell', parent, cell, cell);
    node.setPosition(x, y, 0);

    const g = node.addComponent(Graphics);
    fillRoundRectRim(g, -cell / 2, -cell / 2, cell, cell, 12, COLOR.panelGlass, 2);

    // 缩略图：等比缩放塞进格子
    const thumb = makeNode('Thumb', node, cell, cell);
    const sprite = thumb.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.spriteFrame = frame;
    const w = frame.rect.width;
    const h = frame.rect.height;
    const s = (cell * THUMB_FILL) / Math.max(w, h);
    const tr = thumb.getComponent(UITransform);
    if (tr) tr.setContentSize(w * s, h * s);

    node.on(Node.EventType.TOUCH_END, () => this.showPreview(frame.name), this);
  }

  /**
   * 点格子看大图：优先找同编号的 Preview_ 大图，没有就放大缩略图。
   * 素材只给了 21 张 Preview，所以多数家具会走后者。
   */
  private showPreview(frameName: string) {
    const modal = ModalPanel.open(this.node, frameName);
    const body = modal.body;
    if (!body) return;

    const show = (frame: SpriteFrame) => {
      if (!body.isValid) return;
      const node = makeNode('Big', body, 0, 0);
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.spriteFrame = frame;
      const s = Math.min(modal.bodyW / frame.rect.width, (modal.bodyH * 0.8) / frame.rect.height);
      const tr = node.getComponent(UITransform);
      if (tr) tr.setContentSize(frame.rect.width * s, frame.rect.height * s);
      node.setPosition(0, 0, 0);
    };

    resources.load(`${PREVIEW_DIR}/Preview_${frameName}/spriteFrame`, SpriteFrame, (err, frame) => {
      if (!err && frame) {
        show(frame);
        return;
      }
      // 没有专门的预览图就用缩略图放大
      resources.load(`${FURN_DIR}/${frameName}/spriteFrame`, SpriteFrame, (e2, f2) => {
        if (!e2 && f2) show(f2);
      });
    });
  }

  /** 竖向拖动滚动网格。内容不超过一屏时不启用。 */
  private bindScroll(area: Node, w: number, h: number) {
    const tr = area.getComponent(UITransform);
    if (tr) tr.setContentSize(w, h);
    if (this.gridMaxY <= 0) return;

    area.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      this.dragging = true;
      this.lastTouchY = e.getUILocation().y;
    }, this);
    area.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      if (!this.dragging || !this.grid) return;
      const y = e.getUILocation().y;
      const dy = y - this.lastTouchY;
      this.lastTouchY = y;
      const next = Math.min(this.gridMaxY, Math.max(this.gridMinY, this.grid.position.y + dy));
      this.grid.setPosition(new Vec3(0, next, 0));
    }, this);
    const end = () => { this.dragging = false; };
    area.on(Node.EventType.TOUCH_END, end, this);
    area.on(Node.EventType.TOUCH_CANCEL, end, this);
  }
}
