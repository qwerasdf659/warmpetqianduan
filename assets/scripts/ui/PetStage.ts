/**
 * 3D 宠物舞台。
 *
 * 优先加载 glTF 模型（带 idle 骨骼动画）；加载失败时退回用引擎自带的基础几何体
 * 拼的占位宠物。**任何一条路径都必须出画面**——舞台是主视觉，空一块比丑一点糟得多。
 *
 * 相机分工：
 *   3D 相机 priority 0，负责清屏，只看 DEFAULT 层
 *   UI 相机 priority 1，只清深度不清颜色，只看 UI_2D 层
 * 这样 UI 叠在 3D 画面之上，两边互不干扰。
 */

import {
  _decorator,
  Component,
  Node,
  Camera,
  DirectionalLight,
  MeshRenderer,
  Material,
  Mesh,
  Prefab,
  Canvas,
  Layers,
  Color,
  Vec3,
  Vec4,
  primitives,
  utils,
  instantiate,
  resources,
  EffectAsset,
  Texture2D,
  tween,
  Tween,
  director,
  SkeletalAnimation,
  AnimationClip,
} from 'cc';
import { COLOR } from './widgets';
import store from '../core/store';
import type { PetStage as PetGrowthStage } from '../net/types';

const { ccclass } = _decorator;

/**
 * 占位配色，对齐奶茶米色系（docs/06 §2.2、§3.4）。
 *
 * 浅底方案有个坑：背景一亮，浅色宠物就糊在背景里。
 * 所以毛色要比背景**深一档**，地台再深一档，靠明度差把轮廓拉出来，
 * 而不是靠描边。三档明度依次是 0.90 / 0.76 / 0.70，改一个就要重排三个。
 */
const FUR = new Color(217, 190, 150, 255); // #D9BE96
const FUR_DARK = new Color(196, 168, 126, 255); // #C4A87E
const DARK = new Color(82, 58, 44, 255);
const GROUND = new Color(201, 174, 139, 255); // #C9AE8B

/** 成长阶段只改缩放，不换模型（docs/06 §5.7） */
const STAGE_SCALE: Record<PetGrowthStage, number> = { baby: 0.72, teen: 0.86, adult: 1.0 };

/** 幼崽动作更碎更快 */
const STAGE_SPEED: Record<PetGrowthStage, number> = { baby: 1.15, teen: 1.0, adult: 1.0 };

/**
 * species 的枚举值后端还没定（对接文档现在返回 "default"，见 docs/06 §10）。
 * 拼不出对应模型时一律退回狗，而不是让舞台空着。
 */
const SPECIES_MODEL: Record<string, string> = { cat: 'pet_cat', dog: 'pet_dog' };
const FALLBACK_MODEL = 'pet_dog';

const IDLE_CLIP = 'idle';

/** PBR 材质。不要换成 builtin-unlit，那会退回平涂，3D 就白做了（docs/06 §3.4） */
const EFFECT_NAME = 'builtin-standard';

/** 相机基准参数，docs/06 §3.4 */
const CAM = { y: 1.75, z: 5.4, pitch: -9, fov: 38 };

const BG_NAME = 'bg_room';
/** 背景板放在宠物后方多远。够远才不会被地台的透视穿帮，又不至于糊成一片 */
const BACKDROP_Z_OFFSET = 3.2;
/** 背景板整体下移一点，让画面里的地平线落在地台附近而不是宠物腰上 */
const BACKDROP_DROP = 1.15;

@ccclass('PetStage')
export class PetStage extends Component {
  private root: Node | null = null;
  private camNode: Node | null = null;
  private petRoot: Node | null = null;
  private anim: SkeletalAnimation | null = null;
  private usingModel = false;
  private disposed = false;

  /**
   * 整个 onLoad 包在 try 里：MainView 是先挂本组件、再建 UI 的，
   * 这里一抛异常，后面的属性条和按钮就全都不会创建，界面只剩一片底色。
   * 3D 舞台再重要也只是主视觉，不能连带把可操作的界面一起带走。
   */
  onLoad() {
    try {
      this.setupCameras();
      this.setupLight();

      this.root = new Node('Stage3D');
      this.root.layer = Layers.Enum.DEFAULT;
      this.root.parent = this.node.scene;

      // 地台要等模型加载完再建。运行时只有被资源引用到的 effect 才会打进包里，
      // 而工程里唯一引用 builtin-standard 的就是模型自带的材质——
      // 在它加载完之前 EffectAsset.get 拿不到东西，做出来的材质没有有效 pass。
      this.loadPet();

      store.on('pet', this.syncFromStore, this);
    } catch (err) {
      console.error('[PetStage] 3D 舞台初始化失败，界面继续可用', err);
    }
  }

  onDestroy() {
    this.disposed = true;
    store.off('pet', this.syncFromStore);
    if (this.petRoot) Tween.stopAllByTarget(this.petRoot);
    if (this.root && this.root.isValid) this.root.destroy();
  }

  // ---- 相机与灯光 ----

  private setupCameras() {
    const scene = this.node.scene;

    // UI 相机改成只清深度，否则它会把 3D 画面整片刷掉
    const canvas = scene.getComponentInChildren(Canvas);
    const uiCamera = canvas && canvas.cameraComponent;
    if (uiCamera) {
      uiCamera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
      uiCamera.priority = 1;
      uiCamera.visibility = Layers.Enum.UI_2D;
    }

    const camNode = new Node('Camera3D');
    camNode.layer = Layers.Enum.DEFAULT;
    camNode.parent = scene;
    camNode.setPosition(0, CAM.y, CAM.z);
    camNode.setRotationFromEuler(CAM.pitch, 0, 0);
    this.camNode = camNode;

    const cam = camNode.addComponent(Camera);
    cam.projection = Camera.ProjectionType.PERSPECTIVE;
    cam.fov = CAM.fov;
    cam.near = 0.1;
    cam.far = 100;
    cam.priority = 0;
    cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    cam.clearColor = COLOR.bg;
    cam.visibility = Layers.Enum.DEFAULT;
  }

  private setupLight() {
    const scene = this.node.scene;

    const keyNode = new Node('KeyLight');
    keyNode.layer = Layers.Enum.DEFAULT;
    keyNode.parent = scene;
    // 从左上前方打主光，让球体有明确的明暗交界，立体感主要靠这个
    keyNode.setRotationFromEuler(-52, -35, 0);
    const key = keyNode.addComponent(DirectionalLight);
    key.color = new Color(255, 248, 236, 255);
    key.illuminance = 88000;

    // 环境光用暖米色而不是冷蓝，否则浅暖底上的阴影会发灰发脏。
    // 这里要的是归一化的 Vec4（0–1），不是 0–255 的 Color。
    const globals = director.getScene() && director.getScene().globals;
    if (globals && globals.ambient) {
      globals.ambient.skyColor = new Vec4(0.95, 0.89, 0.81, 1);
      globals.ambient.groundAlbedo = new Vec4(0.72, 0.65, 0.56, 1);
      // 浅底方案要压低环境光：环境光一强，暗面被填平，模型就"塌"成一张贴纸
      globals.ambient.skyIllum = 14000;
    }
  }

  /**
   * 把宠物对准 UI 预留出来的那块空当。
   *
   * 相机是固定的，UI 布局却随可视高度变化——两边各算各的，视口一矮宠物就被面板腰斩。
   * 这里由 UI 把预留区域的中心告诉舞台，相机沿垂直方向补一个偏移，让两者对齐。
   *
   * 相机往下移，宠物在画面里就往上走：宠物位置不变，而取景中心跟着相机降了下去。
   *
   * @param centerY    预留区域中心，UI 坐标（屏幕中心为 0，向上为正）
   * @param viewportH  当前可视高度
   */
  public frameTo(centerY: number, viewportH: number) {
    const cam = this.camNode;
    if (!cam || viewportH <= 0) return;

    // 相机到宠物的实际距离，不是单纯的 z——相机是抬高并俯视的
    const distance = Math.sqrt(CAM.y * CAM.y + CAM.z * CAM.z);
    const halfWorldH = distance * Math.tan((CAM.fov / 2) * (Math.PI / 180));

    const offset = (centerY / (viewportH / 2)) * halfWorldH;
    cam.setPosition(0, CAM.y - offset, CAM.z);
  }

  // ---- 建模 ----

  /**
   * builtin-standard 是 PBR 材质，能吃到光照；unlit 会退回平涂，失去立体感。
   *
   * 颜色属性名是 `mainColor` 而不是 `albedo`——`albedo` 是 effect 里的 shader uniform 名，
   * 不是材质对外的属性名。
   *
   * effect 找不到时返回 null：此时材质没有任何有效 pass，
   * 赋给 MeshRenderer 会在引擎内部抛 `localSetLayout` 的空指针，
   * 报错位置离真正的原因很远，很难查。宁可这一块不渲染，也不要炸掉整个舞台。
   */
  private makeMaterial(color: Color, roughness = 0.9): Material | null {
    const effect = EffectAsset.get(EFFECT_NAME);
    if (!effect) {
      console.error(
        `[PetStage] 运行时找不到 effect "${EFFECT_NAME}"，` +
          `已注册的 effect: ${Object.keys(EffectAsset.getAll()).join(', ')}`,
      );
      return null;
    }

    const mat = new Material();
    mat.initialize({ effectAsset: effect });
    mat.setProperty('mainColor', color);
    mat.setProperty('roughness', roughness);
    mat.setProperty('metallic', 0);
    return mat;
  }

  private addMesh(
    parent: Node,
    name: string,
    mesh: Mesh,
    material: Material | null,
    pos: Vec3,
    scale?: Vec3,
  ): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.DEFAULT;
    node.parent = parent;
    node.setPosition(pos);
    if (scale) node.setScale(scale);

    const mr = node.addComponent(MeshRenderer);
    mr.mesh = mesh;
    // 没有材质就让它用引擎默认材质，至少还有个白色的形能看见
    if (material) mr.material = material;
    return node;
  }

  /**
   * 背景是一张贴在宠物后方的四边形，不是 UI 层的图。
   *
   * UI 相机在 3D 相机之后渲染，任何 UI 底图都会把宠物盖住，所以背景只能待在 3D 层。
   *
   * 材质用 unlit：这张图本身已经画好了光影，再吃一遍实时光会脏。
   * 文档 3.4 说「不要用 unlit」，那条针对的是宠物——平涂会让模型失去立体感；
   * 背景恰恰相反，它就该是平的。
   */
  private buildBackdrop() {
    const distance = BACKDROP_Z_OFFSET + CAM.z;
    // 视锥在该距离上的可视高度；方形贴图按高度铺满，两侧多出的部分被裁掉，
    // 所以构图的安全区是中间那条竖带（docs/06 §6.5）
    const height = 2 * distance * Math.tan((CAM.fov / 2) * (Math.PI / 180));

    const node = new Node('Backdrop');
    node.layer = Layers.Enum.DEFAULT;
    node.parent = this.root!;
    node.setPosition(0, height / 2 - BACKDROP_DROP, -BACKDROP_Z_OFFSET);

    const mr = node.addComponent(MeshRenderer);
    mr.mesh = utils.createMesh(
      primitives.plane({ width: height, length: height, widthSegments: 1, lengthSegments: 1 }),
    );
    // plane 默认躺在 XZ 平面上，立起来才能当背景板
    node.setRotationFromEuler(90, 0, 0);

    resources.load(`bg/${BG_NAME}/texture`, Texture2D, (err, tex) => {
      if (this.disposed || !node.isValid) return;
      if (err || !tex) {
        console.warn(`[PetStage] 背景 ${BG_NAME} 加载失败，保留纯色底`, err);
        node.destroy();
        return;
      }

      const effect = EffectAsset.get('builtin-unlit');
      if (!effect) {
        console.warn('[PetStage] 找不到 builtin-unlit，背景改用纯色底');
        node.destroy();
        return;
      }

      const mat = new Material();
      mat.initialize({ effectAsset: effect });
      mat.setProperty('mainTexture', tex);
      mat.setProperty('mainColor', Color.WHITE);
      mr.material = mat;
    });
  }

  private buildGround() {
    // 用一个很扁的圆柱当地台，比平面多一点厚度，边缘能吃到光
    const mesh = utils.createMesh(primitives.cylinder(2.3, 2.3, 0.14, { radialSegments: 48 }));
    this.addMesh(this.root!, 'Ground', mesh, this.makeMaterial(GROUND), new Vec3(0, -0.07, 0));
  }

  // ---- 宠物本体 ----

  private loadPet() {
    const species = (store.petView && store.petView.species) || '';
    const modelName = SPECIES_MODEL[species] || FALLBACK_MODEL;

    // 模型资源里的 prefab 是子资源，路径要带上同名的那一层
    resources.load(`models/${modelName}/${modelName}`, Prefab, (err, prefab) => {
      if (this.disposed) return;

      if (err || !prefab) {
        console.warn(`[PetStage] 模型 ${modelName} 加载失败，退回占位几何体`, err);
        this.buildBackdrop();
        this.buildGround();
        this.buildPlaceholderPet();
        this.playPlaceholderIdle();
        this.syncFromStore();
        return;
      }

      this.buildBackdrop();
      this.buildGround();
      this.mountModel(instantiate(prefab));
      this.syncFromStore();
    });
  }

  private mountModel(pet: Node) {
    pet.name = 'Pet';
    // new Node() 默认是 DEFAULT 层，但 prefab 里的层由导入设置决定，显式对齐更保险
    this.setLayerRecursive(pet, Layers.Enum.DEFAULT);

    const anim = pet.getComponent(SkeletalAnimation) || pet.getComponentInChildren(SkeletalAnimation);
    if (!anim) {
      console.warn('[PetStage] 模型上没有 SkeletalAnimation，宠物会是静止的');
      pet.parent = this.root!;
      pet.setPosition(0, 0, 0);
      this.petRoot = pet;
      this.usingModel = true;
      return;
    }

    // 关预烘焙必须**赶在节点挂进场景之前**。
    //
    // 组件激活时会按当时的 bake 标志初始化动画状态，而引擎在预烘焙分支里
    // 直接跳过求值器的创建（skeletal-animation-state.ts: `_doNotCreateEval = baked`）。
    // 那一步只跑一次，事后再改标志只是换了采样函数，求值器不存在，采样等于空转——
    // 表现是 isPlaying 为真、time 正常推进，却一个值都落不到骨骼上。
    //
    // prefab 里序列化的默认值是 true，所以这行不能省。
    // 换装挂点也依赖实时蒙皮，见 docs/06 §5.4。
    anim.useBakedAnimation = false;

    pet.parent = this.root!;
    pet.setPosition(0, 0, 0);
    this.petRoot = pet;
    this.usingModel = true;
    this.anim = anim;

    if (!this.playClip(IDLE_CLIP, true)) {
      console.warn(`[PetStage] ${IDLE_CLIP} 没能播放，宠物会停在绑定姿势`);
    }
  }

  private setLayerRecursive(node: Node, layer: number) {
    node.layer = layer;
    for (const child of node.children) this.setLayerRecursive(child, layer);
  }

  /** 播不到就返回 false，让调用方决定要不要降级，不要静默失败 */
  private playClip(name: string, loop: boolean): boolean {
    const anim = this.anim;
    if (!anim) return false;

    const clip = anim.clips.find((c) => !!c && c.name === name);
    if (!clip) {
      console.warn(`[PetStage] 模型里没有 ${name} 动画，现有: ${anim.clips.map((c) => c && c.name)}`);
      return false;
    }

    // glTF 导入的 clip 默认是播放一次，播完停在最后一帧。
    // 待机动画不设循环的话，一个周期之后看起来和静止完全一样，很难看出是动画的问题。
    clip.wrapMode = loop ? AnimationClip.WrapMode.Loop : AnimationClip.WrapMode.Normal;
    anim.play(name);

    const state = anim.getState(name);
    if (state) state.wrapMode = clip.wrapMode;
    return true;
  }

  private buildPlaceholderPet() {
    const pet = new Node('Pet');
    pet.layer = Layers.Enum.DEFAULT;
    pet.parent = this.root!;
    pet.setPosition(0, 0, 0);
    this.petRoot = pet;
    this.usingModel = false;

    const sphere = utils.createMesh(primitives.sphere(0.5, { segments: 32 }));
    const fur = this.makeMaterial(FUR);
    const furDark = this.makeMaterial(FUR_DARK);
    const dark = this.makeMaterial(DARK, 0.45);

    this.addMesh(pet, 'Body', sphere, fur, new Vec3(0, 0.62, 0), new Vec3(1.5, 1.25, 1.35));
    this.addMesh(pet, 'Head', sphere, fur, new Vec3(0, 1.42, 0.16), new Vec3(1.12, 1.05, 1.05));
    this.addMesh(pet, 'EarL', sphere, furDark, new Vec3(-0.3, 1.82, 0.05), new Vec3(0.34, 0.5, 0.2));
    this.addMesh(pet, 'EarR', sphere, furDark, new Vec3(0.3, 1.82, 0.05), new Vec3(0.34, 0.5, 0.2));
    this.addMesh(pet, 'EyeL', sphere, dark, new Vec3(-0.19, 1.46, 0.44), new Vec3(0.15, 0.19, 0.1));
    this.addMesh(pet, 'EyeR', sphere, dark, new Vec3(0.19, 1.46, 0.44), new Vec3(0.15, 0.19, 0.1));
    this.addMesh(pet, 'Nose', sphere, dark, new Vec3(0, 1.31, 0.5), new Vec3(0.12, 0.09, 0.1));
    this.addMesh(pet, 'PawL', sphere, furDark, new Vec3(-0.26, 0.16, 0.34), new Vec3(0.4, 0.3, 0.5));
    this.addMesh(pet, 'PawR', sphere, furDark, new Vec3(0.26, 0.16, 0.34), new Vec3(0.4, 0.3, 0.5));
    this.addMesh(pet, 'Tail', sphere, furDark, new Vec3(0, 0.72, -0.66), new Vec3(0.32, 0.32, 0.4));
  }

  // ---- 状态同步 ----

  private syncFromStore() {
    const pet = store.petView;
    const petRoot = this.petRoot;
    if (!pet || !petRoot) return;

    const scale = STAGE_SCALE[pet.stage] || 1;
    petRoot.setScale(scale, scale, scale);

    if (this.anim) {
      const state = this.anim.getState(IDLE_CLIP);
      if (state) state.speed = STAGE_SPEED[pet.stage] || 1;
    }
  }

  // ---- 动画 ----

  /**
   * 占位宠物没有骨骼，用节点级 tween 造出呼吸和浮动。
   * 静止的模型看着像张图，加一点点周期性起伏就有"活着"的感觉。
   * 有骨骼动画时不要叠加这个，两套节奏打架会显得很乱。
   */
  private playPlaceholderIdle() {
    const pet = this.petRoot;
    if (!pet || this.usingModel) return;

    tween(pet)
      .repeatForever(
        tween<Node>()
          .to(1.4, { scale: new Vec3(1.035, 0.97, 1.02) }, { easing: 'sineInOut' })
          .to(1.4, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
      )
      .start();

    tween(pet)
      .repeatForever(
        tween<Node>()
          .to(2.6, { position: new Vec3(0, 0.05, 0) }, { easing: 'sineInOut' })
          .to(2.6, { position: new Vec3(0, 0, 0) }, { easing: 'sineInOut' }),
      )
      .start();
  }

  /** 互动时晃一下，给点即时反馈 */
  public react() {
    const pet = this.petRoot;
    if (!pet) return;

    const base = pet.scale.clone();
    const squash = new Vec3(base.x * 1.12, base.y * 0.9, base.z * 1.08);
    tween(pet)
      .to(0.1, { scale: squash }, { easing: 'quadOut' })
      .to(0.22, { scale: base }, { easing: 'backOut' })
      .start();
  }
}
