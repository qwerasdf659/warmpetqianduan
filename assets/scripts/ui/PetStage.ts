/**
 * 3D 宠物舞台。
 *
 * 美术模型还没到位，这里用引擎自带的基础几何体（球、圆柱）拼一只占位宠物，
 * 配上真实的透视相机、平行光和地面。它不好看，但它是**真 3D**：
 * 有光照、有明暗、有透视、有呼吸动画，和之前那个平面灰圆完全是两回事。
 *
 * 等美术给到 FBX/glTF 模型时，把 buildPet() 换成加载模型 + SkeletalAnimation 即可，
 * 相机、灯光、地面、待机节奏这些都能直接复用。
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
  Canvas,
  Layers,
  Color,
  Vec3,
  Vec4,
  primitives,
  utils,
  tween,
  director,
} from 'cc';
import { COLOR } from './widgets';

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

@ccclass('PetStage')
export class PetStage extends Component {
  private root: Node | null = null;
  private petRoot: Node | null = null;

  onLoad() {
    this.setupCameras();
    this.setupLight();

    this.root = new Node('Stage3D');
    this.root.layer = Layers.Enum.DEFAULT;
    this.root.parent = this.node.scene;

    this.buildGround();
    this.buildPet();
    this.playIdle();
  }

  onDestroy() {
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
    camNode.setPosition(0, 1.75, 5.4);
    camNode.setRotationFromEuler(-9, 0, 0);

    const cam = camNode.addComponent(Camera);
    cam.projection = Camera.ProjectionType.PERSPECTIVE;
    cam.fov = 38;
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

  // ---- 建模 ----

  /** builtin-standard 是 PBR 材质，能吃到光照；unlit 会退回平涂，失去立体感 */
  private makeMaterial(color: Color, roughness = 0.9): Material {
    const mat = new Material();
    mat.initialize({ effectName: 'builtin-standard' });
    mat.setProperty('albedo', color);
    mat.setProperty('roughness', roughness);
    mat.setProperty('metallic', 0);
    return mat;
  }

  private addMesh(
    parent: Node,
    name: string,
    mesh: Mesh,
    material: Material,
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
    mr.material = material;
    return node;
  }

  private buildGround() {
    // 用一个很扁的圆柱当地台，比平面多一点厚度，边缘能吃到光
    const mesh = utils.createMesh(primitives.cylinder(2.3, 2.3, 0.14, { radialSegments: 48 }));
    this.addMesh(this.root!, 'Ground', mesh, this.makeMaterial(GROUND), new Vec3(0, -0.07, 0));
  }

  private buildPet() {
    const pet = new Node('Pet');
    pet.layer = Layers.Enum.DEFAULT;
    pet.parent = this.root!;
    pet.setPosition(0, 0, 0);
    this.petRoot = pet;

    const sphere = utils.createMesh(primitives.sphere(0.5, { segments: 32 }));
    const fur = this.makeMaterial(FUR);
    const furDark = this.makeMaterial(FUR_DARK);
    const dark = this.makeMaterial(DARK, 0.45);

    // 身体
    this.addMesh(pet, 'Body', sphere, fur, new Vec3(0, 0.62, 0), new Vec3(1.5, 1.25, 1.35));
    // 头
    this.addMesh(pet, 'Head', sphere, fur, new Vec3(0, 1.42, 0.16), new Vec3(1.12, 1.05, 1.05));
    // 耳朵
    this.addMesh(pet, 'EarL', sphere, furDark, new Vec3(-0.3, 1.82, 0.05), new Vec3(0.34, 0.5, 0.2));
    this.addMesh(pet, 'EarR', sphere, furDark, new Vec3(0.3, 1.82, 0.05), new Vec3(0.34, 0.5, 0.2));
    // 眼睛
    this.addMesh(pet, 'EyeL', sphere, dark, new Vec3(-0.19, 1.46, 0.44), new Vec3(0.15, 0.19, 0.1));
    this.addMesh(pet, 'EyeR', sphere, dark, new Vec3(0.19, 1.46, 0.44), new Vec3(0.15, 0.19, 0.1));
    // 鼻子
    this.addMesh(pet, 'Nose', sphere, dark, new Vec3(0, 1.31, 0.5), new Vec3(0.12, 0.09, 0.1));
    // 前脚
    this.addMesh(pet, 'PawL', sphere, furDark, new Vec3(-0.26, 0.16, 0.34), new Vec3(0.4, 0.3, 0.5));
    this.addMesh(pet, 'PawR', sphere, furDark, new Vec3(0.26, 0.16, 0.34), new Vec3(0.4, 0.3, 0.5));
    // 尾巴
    this.addMesh(pet, 'Tail', sphere, furDark, new Vec3(0, 0.72, -0.66), new Vec3(0.32, 0.32, 0.4));
  }

  // ---- 动画 ----

  /**
   * 待机呼吸。
   * 静止的模型看着像张图，加一点点周期性起伏就有"活着"的感觉——
   * 这是没有骨骼动画时性价比最高的一步。
   */
  private playIdle() {
    const pet = this.petRoot;
    if (!pet) return;

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
    tween(pet)
      .to(0.1, { scale: new Vec3(1.12, 0.9, 1.08) }, { easing: 'quadOut' })
      .to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
  }
}
