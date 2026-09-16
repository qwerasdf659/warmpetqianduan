/**
 * 地图 HUD 的矢量图标兜底。
 *
 * 为什么不靠字符：旧版右侧按钮和底部入口用的是 `⚙ ♪ 👥 📷` 这类字符 + 纯文字，
 * 在小屏上读成「一排灰圆圈」，和概念稿里那些有辨识度的彩色图标差得最远。
 * 字符还有个隐患 —— emoji 的字形由系统字体决定，安卓低端机上可能整个缺字。
 *
 * 这里用 Graphics 画简笔图形，零包体、必然出画面。等真美术图到了，
 * `MapHud.loadIcon()` 那条 Sprite 路径会盖在上面，本文件自动退居兜底。
 *
 * 每个函数都只画在 (0,0) 附近的 ±size/2 内，调用方负责摆位。
 */

import { Graphics, Color } from 'cc';
import { COLOR, fillRoundRect } from './widgets';

/**
 * 多色图标的分件配色。
 *
 * 单色图标（一个 `tint` 铺满）实测**远不如竞品丰富**：礼盒/挑战那块区域
 * 「色相种类 1/12、彩色占比 5.4%」，竞品同一块是 **8/12、27.8%**。
 * 全图统计看不出这个差距（会被大片墙地稀释），要用
 * `region-compare.mjs` 单独量按钮区。
 *
 * 每个图标至少给 3 个色相、并且**明暗分层**（主色 + 暗部/浅部），
 * 才有「立体图标」的观感而不是剪影。
 */
// 礼盒：紫盒 + 浅紫盖 + 粉丝带 + 深粉结 + 金珠
const ICON_GIFT_BODY = new Color(199, 154, 212, 255);
const ICON_GIFT_LID = new Color(215, 176, 224, 255);
const ICON_GIFT_RIBBON = new Color(245, 197, 203, 255);
const ICON_GIFT_BOW = new Color(240, 159, 180, 255);
const ICON_GIFT_BEAD = new Color(230, 176, 60, 255);
// 手柄：蓝机身 + 白装饰带 + 深蓝十字键 + 粉/黄按钮
const ICON_PAD_BODY = new Color(168, 207, 232, 255);
const ICON_PAD_TRIM = new Color(255, 252, 247, 255);
const ICON_PAD_DPAD = new Color(110, 143, 168, 255);
const ICON_PAD_BTN_A = new Color(240, 159, 180, 255);
const ICON_PAD_BTN_B = new Color(230, 176, 60, 255);
// 图鉴：木封面 + 米白纸 + 深棕爪印 + 浅色文字线
const ICON_BOOK_COVER = new Color(206, 165, 114, 255);
const ICON_BOOK_PAGE = new Color(255, 252, 247, 255);
const ICON_BOOK_PAW = new Color(138, 106, 79, 255);
const ICON_BOOK_LINE = new Color(216, 203, 184, 255);
// 商店：红白棚 + 米白墙 + 木柜台 + 粉罐
const ICON_SHOP_AWNING_A = new Color(224, 138, 128, 255);
const ICON_SHOP_AWNING_B = new Color(255, 252, 247, 255);
const ICON_SHOP_WALL = new Color(247, 239, 226, 255);
const ICON_SHOP_DESK = new Color(206, 165, 114, 255);
const ICON_SHOP_JAR = new Color(245, 197, 203, 255);
// 领取：粉徽章 + 白花边 + 金星 + 粉缎带
const ICON_CLAIM_BODY = new Color(240, 159, 180, 255);
const ICON_CLAIM_LACE = new Color(255, 252, 247, 255);
const ICON_CLAIM_STAR = new Color(230, 176, 60, 255);
const ICON_CLAIM_RIBBON = new Color(245, 197, 203, 255);

/** 猫脸：头 + 两只耳 + 两只眼 + 鼻。头像框的兜底，比爪印占位更像「我的宠物」 */
export function paintCatFace(g: Graphics, r: number, fur: Color): void {
  // 耳朵先画（在头后面，露出三角尖）
  g.fillColor = fur;
  g.circle(-r * 0.62, r * 0.6, r * 0.34);
  g.circle(r * 0.62, r * 0.6, r * 0.34);
  g.fill();

  // 头
  g.fillColor = fur;
  g.circle(0, 0, r);
  g.fill();

  // 眼睛
  g.fillColor = COLOR.title;
  g.circle(-r * 0.36, r * 0.12, r * 0.14);
  g.circle(r * 0.36, r * 0.12, r * 0.14);
  g.fill();

  // 鼻子
  g.fillColor = COLOR.danger;
  g.circle(0, -r * 0.22, r * 0.11);
  g.fill();
}

/** 齿轮：一圈小方齿 + 中心圆孔 */
export function paintGear(g: Graphics, r: number, tint: Color): void {
  g.fillColor = tint;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.circle(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, r * 0.24);
  }
  g.circle(0, 0, r * 0.66);
  g.fill();
  g.fillColor = COLOR.panel;
  g.circle(0, 0, r * 0.28);
  g.fill();
}

/** 音符：一个圆头 + 一根竖杆 + 旗 */
export function paintNote(g: Graphics, r: number, tint: Color): void {
  g.fillColor = tint;
  g.circle(-r * 0.24, -r * 0.42, r * 0.34);
  g.rect(r * 0.02, -r * 0.42, r * 0.2, r * 1.2);
  g.rect(r * 0.02, r * 0.6, r * 0.62, r * 0.2);
  g.fill();
}

/** 好友：两个人头剪影（一大一小，靠错位区分） */
export function paintFriends(g: Graphics, r: number, tint: Color): void {
  g.fillColor = tint;
  // 后面那个小一点
  g.circle(r * 0.34, r * 0.28, r * 0.28);
  fillRoundRect(g, r * 0.02, -r * 0.66, r * 0.64, r * 0.62, r * 0.22, tint);
  // 前面那个
  g.fillColor = tint;
  g.circle(-r * 0.24, r * 0.3, r * 0.34);
  g.fill();
  fillRoundRect(g, -r * 0.68, -r * 0.72, r * 0.88, r * 0.76, r * 0.26, tint);
}

/** 相机：机身 + 镜头 + 取景器凸起 */
export function paintCamera(g: Graphics, r: number, tint: Color): void {
  fillRoundRect(g, -r * 0.86, r * 0.34, r * 0.5, r * 0.24, r * 0.08, tint);
  fillRoundRect(g, -r * 0.9, -r * 0.62, r * 1.8, r * 1.06, r * 0.2, tint);
  g.fillColor = COLOR.panel;
  g.circle(0, -r * 0.08, r * 0.34);
  g.fill();
  g.fillColor = tint;
  g.circle(0, -r * 0.08, r * 0.17);
  g.fill();
}

/** 图鉴：摊开的书（木质封面 + 米白纸页 + 爪印 + 文字线） */
export function paintBook(g: Graphics, r: number, tint: Color): void {
  // 封面（比纸页大一圈，露出书脊厚度）
  fillRoundRect(g, -r * 0.9, -r * 0.66, r * 1.8, r * 1.32, r * 0.12, ICON_BOOK_COVER);
  // 两页纸
  fillRoundRect(g, -r * 0.8, -r * 0.56, r * 0.74, r * 1.12, r * 0.08, ICON_BOOK_PAGE);
  fillRoundRect(g, r * 0.06, -r * 0.56, r * 0.74, r * 1.12, r * 0.08, ICON_BOOK_PAGE);
  // 左页爪印
  g.fillColor = ICON_BOOK_PAW;
  g.circle(-r * 0.43, r * 0.08, r * 0.16);
  [-0.24, 0, 0.24].forEach((dx, i) => {
    g.circle(-r * 0.43 + r * dx, r * 0.36 + (i === 1 ? r * 0.06 : 0), r * 0.07);
  });
  g.fill();
  // 右页文字线
  g.fillColor = ICON_BOOK_LINE;
  [0.24, 0.02, -0.2].forEach((dy) => g.rect(r * 0.16, r * dy, r * 0.54, r * 0.08));
  g.fill();
}

/** 商店：红白遮阳棚 + 米白店面 + 木柜台 + 粉罐 */
export function paintShop(g: Graphics, r: number, tint: Color): void {
  // 店面墙
  fillRoundRect(g, -r * 0.82, -r * 0.72, r * 1.64, r * 1.1, r * 0.1, ICON_SHOP_WALL);
  // 遮阳棚：红白交替的圆弧
  for (let i = -2; i <= 2; i++) {
    g.fillColor = i % 2 === 0 ? ICON_SHOP_AWNING_A : ICON_SHOP_AWNING_B;
    g.circle(i * r * 0.34, r * 0.34, r * 0.21);
    g.fill();
  }
  // 棚顶压条
  fillRoundRect(g, -r * 0.88, r * 0.44, r * 1.76, r * 0.18, r * 0.08, ICON_SHOP_AWNING_A);
  // 柜台 + 台上小罐
  fillRoundRect(g, -r * 0.5, -r * 0.72, r * 1.0, r * 0.42, r * 0.06, ICON_SHOP_DESK);
  g.fillColor = ICON_SHOP_JAR;
  g.circle(0, -r * 0.18, r * 0.15);
  g.fill();
}

/** 领取：粉色圆徽章 + 金五角星 + 缎带尾 */
export function paintClaim(g: Graphics, r: number, tint: Color): void {
  // 缎带（先画，压在徽章下面）
  g.fillColor = ICON_CLAIM_RIBBON;
  g.rect(-r * 0.38, -r * 0.9, r * 0.26, r * 0.5);
  g.rect(r * 0.12, -r * 0.9, r * 0.26, r * 0.5);
  g.fill();
  // 花边（比徽章大一圈的白圈）
  g.fillColor = ICON_CLAIM_LACE;
  g.circle(0, r * 0.06, r * 0.78);
  g.fill();
  // 徽章主体
  g.fillColor = ICON_CLAIM_BODY;
  g.circle(0, r * 0.06, r * 0.64);
  g.fill();
  // 金五角星（五个顶点用小圆近似，Graphics 没有星形）
  g.fillColor = ICON_CLAIM_STAR;
  g.circle(0, r * 0.06, r * 0.2);
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI / 2) + (i * Math.PI * 2) / 5;
    g.circle(Math.cos(a) * r * 0.3, r * 0.06 + Math.sin(a) * r * 0.3, r * 0.11);
  }
  g.fill();
}

/**
 * 礼盒：盒身 + 盒盖 + 交叉丝带 + 蝴蝶结 + 金珠。
 *
 * **五个色相**（盒身紫 / 盒盖浅紫 / 丝带粉 / 蝴蝶结深粉 / 金珠金）。
 * 单色版实测：礼盒那块区域「色相种类 1/12、彩色占比 5.4%」，
 * 竞品同一块是 **8/12、27.8%** —— 这就是「UI 不够丰富」的量化来源。
 */
export function paintGift(g: Graphics, r: number, tint: Color): void {
  // 盒身
  fillRoundRect(g, -r * 0.78, -r * 0.72, r * 1.56, r * 1.0, r * 0.12, ICON_GIFT_BODY);
  // 盒盖（比盒身宽一点，出「盖子有厚度」）
  fillRoundRect(g, -r * 0.88, r * 0.2, r * 1.76, r * 0.34, r * 0.1, ICON_GIFT_LID);
  // 竖丝带 + 横丝带
  g.fillColor = ICON_GIFT_RIBBON;
  g.rect(-r * 0.16, -r * 0.72, r * 0.32, r * 0.92);
  g.rect(-r * 0.78, -r * 0.3, r * 1.56, r * 0.22);
  g.fill();
  // 蝴蝶结两瓣
  g.fillColor = ICON_GIFT_BOW;
  g.circle(-r * 0.3, r * 0.68, r * 0.26);
  g.circle(r * 0.3, r * 0.68, r * 0.26);
  g.fill();
  // 结心金珠
  g.fillColor = ICON_GIFT_BEAD;
  g.circle(0, r * 0.66, r * 0.14);
  g.fill();
}

/**
 * 挑战：游戏手柄（机身 + 装饰带 + 十字键 + 两个圆按钮）。
 * 四个色相 —— 竞品这个位置也是彩色手柄，不是单色奖杯。
 */
export function paintTrophy(g: Graphics, r: number, tint: Color): void {
  // 机身：中间宽、两侧握把
  fillRoundRect(g, -r * 0.92, -r * 0.44, r * 1.84, r * 0.9, r * 0.32, ICON_PAD_BODY);
  // 浅色装饰带
  fillRoundRect(g, -r * 0.92, -r * 0.1, r * 1.84, r * 0.16, r * 0.08, ICON_PAD_TRIM);
  // 左侧十字方向键
  g.fillColor = ICON_PAD_DPAD;
  g.rect(-r * 0.56, r * 0.02, r * 0.1, r * 0.3);
  g.rect(-r * 0.66, r * 0.12, r * 0.3, r * 0.1);
  g.fill();
  // 右侧两个圆按钮，两种色
  g.fillColor = ICON_PAD_BTN_A;
  g.circle(r * 0.4, r * 0.24, r * 0.13);
  g.fill();
  g.fillColor = ICON_PAD_BTN_B;
  g.circle(r * 0.62, r * 0.06, r * 0.13);
  g.fill();
}

// 需求气泡图标的配色
const NEED_FISH_BODY = new Color(232, 176, 118, 255);
const NEED_FISH_FIN = new Color(224, 138, 128, 255);
const NEED_WATER = new Color(110, 170, 214, 255);
const NEED_BALL = new Color(238, 143, 160, 255);
const NEED_BALL_LINE = new Color(255, 252, 247, 255);

/** 需求：鱼（喂食）。侧身鱼形 —— 椭圆身 + 三角尾 + 圆眼 */
export function paintFish(g: Graphics, r: number): void {
  g.fillColor = NEED_FISH_BODY;
  g.ellipse(-r * 0.1, 0, r * 0.72, r * 0.44);
  g.fill();
  // 尾鳍
  g.fillColor = NEED_FISH_FIN;
  g.circle(r * 0.66, r * 0.28, r * 0.24);
  g.circle(r * 0.66, -r * 0.28, r * 0.24);
  g.fill();
  g.fillColor = NEED_FISH_BODY;
  g.circle(r * 0.5, 0, r * 0.28);
  g.fill();
  // 眼
  g.fillColor = COLOR.title;
  g.circle(-r * 0.42, r * 0.06, r * 0.09);
  g.fill();
}

/** 需求：水滴（洗澡）。上尖下圆 —— 一个圆 + 顶上一个小三角近似 */
export function paintDrop(g: Graphics, r: number): void {
  g.fillColor = NEED_WATER;
  g.circle(0, -r * 0.22, r * 0.5);
  // 尖头用一串收窄的小圆凑
  g.circle(0, r * 0.16, r * 0.34);
  g.circle(0, r * 0.42, r * 0.18);
  g.circle(0, r * 0.58, r * 0.08);
  g.fill();
  // 高光
  g.fillColor = NEED_BALL_LINE;
  g.circle(-r * 0.16, -r * 0.28, r * 0.12);
  g.fill();
}

/** 需求：毛线球（陪玩）。粉球 + 两道白色缠线 */
export function paintYarn(g: Graphics, r: number): void {
  g.fillColor = NEED_BALL;
  g.circle(0, 0, r * 0.6);
  g.fill();
  // 缠线：两条错开的细带
  g.fillColor = NEED_BALL_LINE;
  g.rect(-r * 0.58, -r * 0.1, r * 1.16, r * 0.08);
  g.rect(-r * 0.42, r * 0.24, r * 0.9, r * 0.08);
  g.rect(-r * 0.42, -r * 0.42, r * 0.9, r * 0.08);
  g.fill();
}

/**
 * 每个图标的专属色。
 *
 * 为什么不统一用 `COLOR.accent`：实测对比竞品截图，我们**有彩色像素只占 7.2%，
 * 竞品是 21.6%**（`.build/scripts/color-compare.mjs`）。原因就是所有图标
 * 都染成同一个焦糖色，一排下来是单色剪影，而竞品每个图标各有色相
 * （设置蓝灰、音量橙、好友紫、相册青、商店红棚…），一眼能分辨。
 *
 * 这也是「UI 看起来更好」的一半来源 —— 不是造型问题，是色彩信息量问题。
 * 色相要和功能语义对齐（商店=暖红招徕、挑战=奖杯金、领取=礼物粉）。
 *
 * ⚠️ **但饱和度要克制**。第一版给得太艳，全图「有彩色像素」占到 15.5%，
 * 竞品只有 9.8% —— 结果是画面吵、不舒服。现在每个色都往浅里提了一档：
 * 保住色相区分（这是功能可辨识的关键），但降低纯度。
 * 判据用 `.build/scripts/color-compare.mjs` 的「有彩色像素占比」，
 * 目标 10% 上下，不要超过 12%。
 */
const ICON_COLOR: Record<string, Color> = {
  settings: new Color(150, 164, 178, 255),
  sound: new Color(232, 176, 118, 255),
  friends: new Color(164, 150, 202, 255),
  album: new Color(130, 186, 196, 255),
  dex: new Color(152, 184, 138, 255),
  shop: new Color(220, 142, 130, 255),
  claim: new Color(236, 174, 192, 255),
  gift: new Color(204, 154, 204, 255),
  challenge: new Color(230, 190, 108, 255),
};

/**
 * 取某个 key 的图标色，没有专属色时退回传入的默认色。
 *
 * ⚠️ **多色图标（gift / challenge / dex / shop / claim）不用这个值** ——
 * 它们内部用 `ICON_*` 分件配色，`tint` 参数被忽略。
 * `ICON_COLOR` 里那几项只对单色图标（settings / sound / friends / album）生效。
 */
export function iconColor(key: string, fallback: Color): Color {
  return ICON_COLOR[key] || fallback;
}

/**
 * 按 key 分派。没有对应实现时返回 false，调用方退回文字。
 * `tint` 只作为**兜底**：有专属色的 key 一律用专属色（见 ICON_COLOR）。
 */
export function paintIconByKey(g: Graphics, key: string, r: number, tint: Color): boolean {
  const c = iconColor(key, tint);
  switch (key) {
    case 'settings': paintGear(g, r, c); return true;
    case 'sound': paintNote(g, r, c); return true;
    case 'friends': paintFriends(g, r, c); return true;
    case 'album': paintCamera(g, r, c); return true;
    case 'dex': paintBook(g, r, c); return true;
    case 'shop': paintShop(g, r, c); return true;
    case 'claim': paintClaim(g, r, c); return true;
    case 'gift': paintGift(g, r, c); return true;
    case 'challenge': paintTrophy(g, r, c); return true;
    default: return false;
  }
}
