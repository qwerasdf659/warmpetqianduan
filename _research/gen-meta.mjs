/**
 * 为 assets/ 下所有文件与目录生成 .meta，并写出 main.scene。
 *
 * Cocos 首次打开工程时也会自动补 .meta，但 uuid 是随机的；
 * 场景里引用脚本组件必须写脚本资源的压缩 uuid，所以这里用「路径哈希」派生
 * 一份稳定的 uuid，保证任何人 clone 下来打开工程，场景都能找到 Main 组件。
 *
 * 用法：node _research/gen-meta.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');

// ---- uuid 压缩，算法对齐 engine/cocos/core/utils/decode-uuid.ts ----

const BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * @param headLength 保留多少个十六进制字符不编码。
 *   资源 uuid（脚本、场景等在序列化里被引用的东西）用 5，结果 23 字符；
 *   引擎的 decodeUuid 处理的是 headLength=2 的 22 字符形式。
 *   这个差别是从编译产物里实测出来的，见文件末尾的自检。
 */
function compressUuid(uuid, headLength) {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error(`uuid 长度不对: ${uuid}`);
  let out = hex.slice(0, headLength);
  for (let i = headLength; i < 32; i += 3) {
    const v = parseInt(hex.slice(i, i + 3), 16); // 12 bit
    out += BASE64_KEYS[v >> 6] + BASE64_KEYS[v & 0x3f];
  }
  return out;
}

/** 引擎里的解码实现，用来反向验证 */
function decodeUuid(base64) {
  const HexChars = '0123456789abcdef'.split('');
  const values = new Array(123).fill(64);
  for (let i = 0; i < 64; ++i) values[BASE64_KEYS.charCodeAt(i)] = i;

  const _t = ['', '', '', ''];
  const tpl = _t.concat(_t, '-', _t, '-', _t, '-', _t, '-', _t, _t, _t);
  const indices = tpl.map((x, i) => (x === '-' ? NaN : i)).filter(Number.isFinite);

  tpl[0] = base64[0];
  tpl[1] = base64[1];
  for (let i = 2, j = 2; i < 22; i += 2) {
    const lhs = values[base64.charCodeAt(i)];
    const rhs = values[base64.charCodeAt(i + 1)];
    tpl[indices[j++]] = HexChars[lhs >> 2];
    tpl[indices[j++]] = HexChars[((lhs & 3) << 2) | (rhs >> 4)];
    tpl[indices[j++]] = HexChars[rhs & 0xf];
  }
  return tpl.join('');
}

// 自检 1：引擎 decode-uuid.ts 文档里给的测试向量（22 字符形式）
{
  const uuid = 'fc991dd7-0033-4b80-9d41-c8a86a702e59';
  const expect = 'fcmR3XADNLgJ1ByKhqcC5Z';
  const got = compressUuid(uuid, 2);
  if (got !== expect) throw new Error(`compressUuid(2) 自检失败: ${got} != ${expect}`);
  if (decodeUuid(expect) !== uuid) throw new Error('decodeUuid 自检失败');
}

// 自检 2：资源 uuid 的 23 字符形式。
// 期望值抄自 Cocos 自己编译 Main.ts 产出的 `_cclegacy._RF.push({}, "<id>", "Main")`，
// 这条断言挂了就说明 uuid 派生规则被改动过，场景会找不到脚本。
{
  const uuid = 'c9f9a969-9b9d-45e3-87ba-23f464029b75';
  const expect = 'c9f9alpm51F44e6I/RkApt1';
  const got = compressUuid(uuid, 5);
  if (got !== expect) throw new Error(`compressUuid(5) 自检失败: ${got} != ${expect}`);
}

/** 由路径派生稳定 uuid（v4 格式，但内容来自哈希，保证可复现） */
function uuidFor(relPath) {
  const h = crypto.createHash('sha1').update(`warmpet:${relPath}`).digest('hex');
  const b = h.slice(0, 32).split('');
  b[12] = '4'; // version 4
  b[16] = '8'; // variant
  const s = b.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

// ---- meta 模板 ----

const dirMeta = (uuid) => ({
  ver: '1.2.0',
  importer: 'directory',
  imported: true,
  uuid,
  files: [],
  subMetas: {},
  userData: { compressionType: {}, isRemoteBundle: {} },
});

const tsMeta = (uuid) => ({
  ver: '4.0.24',
  importer: 'typescript',
  imported: true,
  uuid,
  files: [],
  subMetas: {},
  userData: {},
});

const sceneMeta = (uuid) => ({
  ver: '1.1.42',
  importer: 'scene',
  imported: true,
  uuid,
  files: ['.json'],
  subMetas: {},
  userData: {},
});

function writeJson(file, obj) {
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function relOf(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

let written = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith('.meta')) continue;
    const abs = path.join(dir, entry.name);
    const rel = relOf(abs);
    const metaPath = `${abs}.meta`;

    if (entry.isDirectory()) {
      writeJson(metaPath, dirMeta(uuidFor(rel)));
      written++;
      walk(abs);
    } else if (entry.name.endsWith('.ts')) {
      writeJson(metaPath, tsMeta(uuidFor(rel)));
      written++;
    } else if (entry.name.endsWith('.scene')) {
      writeJson(metaPath, sceneMeta(uuidFor(rel)));
      written++;
    }
  }
}

walk(ASSETS);

// ---- 写场景 ----

const sceneRel = 'assets/scenes/main.scene';
const sceneUuid = uuidFor(sceneRel);
const mainScriptUuid = compressUuid(uuidFor('assets/scripts/Main.ts'), 5);

const W = 720;
const H = 1280;

const scene = [
  { __type__: 'cc.SceneAsset', _name: 'main', _objFlags: 0, _native: '', scene: { __id__: 1 } },
  {
    __type__: 'cc.Scene',
    _name: 'main',
    _objFlags: 0,
    _parent: null,
    _children: [{ __id__: 2 }],
    _active: true,
    _components: [],
    _prefab: null,
    autoReleaseAssets: false,
    _globals: { __id__: 9 },
    _id: sceneUuid,
  },
  {
    __type__: 'cc.Node',
    _name: 'Canvas',
    _objFlags: 0,
    _parent: { __id__: 1 },
    _children: [{ __id__: 3 }, { __id__: 4 }],
    _active: true,
    _components: [{ __id__: 6 }, { __id__: 7 }, { __id__: 8 }],
    _prefab: null,
    _lpos: { __type__: 'cc.Vec3', x: W / 2, y: H / 2, z: 0 },
    _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
    _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
    _layer: 33554432,
    _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
    _id: 'warmpetCanvasNode0001',
  },
  {
    __type__: 'cc.Node',
    _name: 'Camera',
    _objFlags: 0,
    _parent: { __id__: 2 },
    _children: [],
    _active: true,
    _components: [{ __id__: 5 }],
    _prefab: null,
    _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 1000 },
    _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
    _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
    _layer: 1073741824,
    _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
    _id: 'warmpetCameraNode001',
  },
  {
    __type__: 'cc.Node',
    _name: 'Main',
    _objFlags: 0,
    _parent: { __id__: 2 },
    _children: [],
    _active: true,
    _components: [{ __id__: 10 }, { __id__: 11 }],
    _prefab: null,
    _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
    _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
    _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
    _layer: 33554432,
    _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
    _id: 'warmpetMainNode00001',
  },
  {
    __type__: 'cc.Camera',
    _name: '',
    _objFlags: 0,
    node: { __id__: 3 },
    _enabled: true,
    __prefab: null,
    _projection: 0,
    _priority: 0,
    _fov: 45,
    _fovAxis: 0,
    _orthoHeight: H / 2,
    _near: 0,
    _far: 2000,
    _color: { __type__: 'cc.Color', r: 28, g: 26, b: 36, a: 255 },
    _depth: 1,
    _stencil: 0,
    _clearFlags: 7,
    _rect: { __type__: 'cc.Rect', x: 0, y: 0, width: 1, height: 1 },
    _aperture: 19,
    _shutter: 7,
    _iso: 0,
    _screenScale: 1,
    _visibility: 1108344832,
    _targetTexture: null,
    _id: 'warmpetCameraComp01',
  },
  {
    __type__: 'cc.UITransform',
    _name: '',
    _objFlags: 0,
    node: { __id__: 2 },
    _enabled: true,
    __prefab: null,
    _contentSize: { __type__: 'cc.Size', width: W, height: H },
    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
    _id: 'warmpetCanvasTrans1',
  },
  {
    __type__: 'cc.Canvas',
    _name: '',
    _objFlags: 0,
    node: { __id__: 2 },
    _enabled: true,
    __prefab: null,
    _cameraComponent: { __id__: 5 },
    _alignCanvasWithScreen: true,
    _id: 'warmpetCanvasComp01',
  },
  {
    __type__: 'cc.Widget',
    _name: '',
    _objFlags: 0,
    node: { __id__: 2 },
    _enabled: true,
    __prefab: null,
    _alignFlags: 45,
    _target: null,
    _left: 0,
    _right: 0,
    _top: 0,
    _bottom: 0,
    _horizontalCenter: 0,
    _verticalCenter: 0,
    _isAbsLeft: true,
    _isAbsRight: true,
    _isAbsTop: true,
    _isAbsBottom: true,
    _isAbsHorizontalCenter: true,
    _isAbsVerticalCenter: true,
    _originalWidth: 0,
    _originalHeight: 0,
    _alignMode: 2,
    _lockFlags: 0,
    _id: 'warmpetCanvasWidget',
  },
  {
    __type__: 'cc.SceneGlobals',
    ambient: { __id__: 12 },
    shadows: { __id__: 13 },
    _skybox: { __id__: 14 },
    fog: { __id__: 15 },
    octree: { __id__: 16 },
    skin: { __id__: 17 },
  },
  {
    __type__: 'cc.UITransform',
    _name: '',
    _objFlags: 0,
    node: { __id__: 4 },
    _enabled: true,
    __prefab: null,
    _contentSize: { __type__: 'cc.Size', width: W, height: H },
    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
    _id: 'warmpetMainTrans001',
  },
  {
    // 用户脚本组件的 __type__ 是脚本资源的压缩 uuid
    __type__: mainScriptUuid,
    _name: '',
    _objFlags: 0,
    node: { __id__: 4 },
    _enabled: true,
    __prefab: null,
    _id: 'warmpetMainComp0001',
  },
  {
    __type__: 'cc.AmbientInfo',
    _skyColorHDR: { __type__: 'cc.Vec4', x: 0, y: 0, z: 0, w: 0.520833125 },
    _skyColor: { __type__: 'cc.Vec4', x: 0, y: 0, z: 0, w: 0.520833125 },
    _skyIllumHDR: 20000,
    _skyIllum: 20000,
    _groundAlbedoHDR: { __type__: 'cc.Vec4', x: 0, y: 0, z: 0, w: 0 },
    _groundAlbedo: { __type__: 'cc.Vec4', x: 0, y: 0, z: 0, w: 0 },
    _skyColorLDR: { __type__: 'cc.Vec4', x: 0.2, y: 0.5, z: 0.8, w: 1 },
    _skyIllumLDR: 20000,
    _groundAlbedoLDR: { __type__: 'cc.Vec4', x: 0.2, y: 0.2, z: 0.2, w: 1 },
  },
  {
    __type__: 'cc.ShadowsInfo',
    _enabled: false,
    _type: 0,
    _normal: { __type__: 'cc.Vec3', x: 0, y: 1, z: 0 },
    _distance: 0,
    _shadowColor: { __type__: 'cc.Color', r: 76, g: 76, b: 76, a: 255 },
    _maxReceived: 4,
    _size: { __type__: 'cc.Vec2', x: 512, y: 512 },
  },
  {
    __type__: 'cc.SkyboxInfo',
    _envLightingType: 0,
    _envmapHDR: null,
    _envmap: null,
    _envmapLDR: null,
    _diffuseMapHDR: null,
    _diffuseMapLDR: null,
    _enabled: false,
    _useHDR: true,
  },
  {
    __type__: 'cc.FogInfo',
    _type: 0,
    _fogColor: { __type__: 'cc.Color', r: 200, g: 200, b: 200, a: 255 },
    _enabled: false,
    _fogDensity: 0.3,
    _fogStart: 0.5,
    _fogEnd: 300,
    _fogAtten: 5,
    _fogTop: 1.5,
    _fogRange: 1.2,
    _accurate: false,
  },
  {
    __type__: 'cc.OctreeInfo',
    _enabled: false,
    _minPos: { __type__: 'cc.Vec3', x: -1024, y: -1024, z: -1024 },
    _maxPos: { __type__: 'cc.Vec3', x: 1024, y: 1024, z: 1024 },
    _depth: 8,
  },
  { __type__: 'cc.SkinInfo', _enabled: false, _scale: 5 },
];

const sceneFile = path.join(ROOT, sceneRel);
fs.mkdirSync(path.dirname(sceneFile), { recursive: true });
fs.writeFileSync(sceneFile, `${JSON.stringify(scene, null, 2)}\n`, 'utf8');
writeJson(`${sceneFile}.meta`, sceneMeta(sceneUuid));
writeJson(path.join(ROOT, 'assets/scenes.meta'), dirMeta(uuidFor('assets/scenes')));

console.log(`已生成 ${written} 个 meta`);
console.log(`场景 uuid       : ${sceneUuid}`);
console.log(`Main.ts uuid    : ${uuidFor('assets/scripts/Main.ts')}`);
console.log(`Main.ts 压缩 uuid: ${mainScriptUuid}`);
