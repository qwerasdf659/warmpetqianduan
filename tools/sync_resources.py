"""把 assets-src 的构建产物同步进 assets/resources，并记账。

跑在**系统 Python** 里（不需要 Blender）：

    python tools/sync_resources.py            # 同步 + 更新清单
    python tools/sync_resources.py --check    # 只校验，不落盘；不同步就退出码 1

存在的理由
----------
同一个 pet_cat.glb 之前在工作区里有六份，大小各不相同，没人说得清哪份是
正在出包的那份。根因是这条链的每一段都靠手工：

    源网格 -> build_* 脚本 -> assets-src/pet/*.glb -> 手工复制 -> assets/resources/models/

手工复制那一步既没记录也没校验，实验产物（以前写在 temp/ 下）又和正式产物
长得一模一样。

这个脚本把最后一段变成一条命令，并把结果写进 assets-src/BUILD.json：
每个出包模型的 sha256、字节数、以及**重建它的确切命令**。
从此「哪个是当前正确的产物」有唯一答案——清单里那个 sha256。

实验产物请写到 .build/ 下（已 gitignore）。不要写 temp/：
那是 Cocos 自己的目录，cocos-toolchain 规则里「预览坏掉就删 temp/」
会把你的中间产物一起删掉。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(REPO_ROOT, "assets-src", "BUILD.json")

# 出包模型 -> (源产物, 重建命令)
#
# 命令是给人看的，也是清单里唯一能回答「这东西怎么来的」的地方。
# 加物种时这里也要加一行，否则新模型不会被同步，PetStage 会静默退回狗。
RECIPES: dict[str, tuple[str, str]] = {
    "assets/resources/models/pet_cat.glb": (
        "assets-src/pet/pet_cat.glb",
        r"tools\blender.ps1 build_pet_from_source.py "
        r"--source assets-src/pet/source/cat_normalized.glb --out assets-src/pet --name pet_cat",
    ),
    "assets/resources/models/pet_dog.glb": (
        "assets-src/pet/pet_dog.glb",
        r"tools\blender.ps1 build_skeleton.py --out assets-src/pet --species dog",
    ),
    "assets/resources/models/acc_cap.glb": (
        "assets-src/accessory/acc_cap.glb",
        r"tools\blender.ps1 build_accessory.py --out assets-src/accessory",
    ),
}

# 参与烘焙的输入，本身不进 resources（贴图烘进 GLB 了），
# 但要记指纹：贴图换了而模型没重导，光看 GLB 是看不出来的。
TRACKED_INPUTS = [
    "assets-src/pet/tex/pet_cat_basecolor.jpg",
    "assets-src/pet/tex/pet_cat_normal.jpg",
    "assets-src/pet/tex/pet_dog_basecolor.jpg",
    "assets-src/pet/tex/pet_dog_normal.jpg",
    "assets-src/pet/tex/fur_detail.png",
    "assets-src/pet/tex/eye_detail.png",
    "assets-src/pet/source/cat_normalized.glb",
]


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def rel(path: str) -> str:
    return os.path.relpath(path, REPO_ROOT).replace("\\", "/")


def fingerprint(relpath: str) -> dict | None:
    full = os.path.join(REPO_ROOT, relpath)
    if not os.path.exists(full):
        return None
    return {"sha256": sha256(full), "bytes": os.path.getsize(full)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--check",
        action="store_true",
        help="只校验 resources 与 assets-src 是否一致，不写任何文件",
    )
    args = ap.parse_args()

    problems: list[str] = []
    copied: list[str] = []
    models: dict[str, dict] = {}

    for dest_rel, (src_rel, recipe) in sorted(RECIPES.items()):
        src = os.path.join(REPO_ROOT, src_rel)
        dest = os.path.join(REPO_ROOT, dest_rel)

        if not os.path.exists(src):
            problems.append(f"源产物不存在：{src_rel}\n    重建：{recipe}")
            continue

        src_hash = sha256(src)
        dest_hash = sha256(dest) if os.path.exists(dest) else None

        if dest_hash != src_hash:
            if args.check:
                state = "缺失" if dest_hash is None else f"不一致（{dest_hash[:12]}）"
                problems.append(
                    f"{dest_rel} {state}，源是 {src_hash[:12]}\n"
                    f"    修：python tools/sync_resources.py"
                )
            else:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copy2(src, dest)
                copied.append(dest_rel)

        # Cocos 靠 .meta 里的 UUID 认资源，缺了场景就引用不到
        if not os.path.exists(dest + ".meta"):
            problems.append(
                f"{dest_rel}.meta 不存在——新增资源要让编辑器导入一次，"
                f"或跑 node _research/gen-meta.mjs（注意它会重写 main.scene）"
            )

        models[dest_rel] = {
            "sha256": src_hash,
            "bytes": os.path.getsize(src),
            "builtFrom": src_rel,
            "rebuild": recipe,
        }

    inputs = {p: fingerprint(p) for p in TRACKED_INPUTS}
    missing_inputs = [p for p, v in inputs.items() if v is None]

    if args.check:
        if problems:
            print("产物不同步：\n")
            for p in problems:
                print("  - " + p)
            return 1
        print(f"{len(models)} 个出包模型与 assets-src 一致。")
        if missing_inputs:
            print("（以下烘焙输入不在工作区，清单里会记成 null：）")
            for p in missing_inputs:
                print("  - " + p)
        return 0

    payload = {
        "//": [
            "由 tools/sync_resources.py 生成，勿手改。",
            "这是「哪份产物是当前出包的那份」的唯一事实来源。",
            "rebuild 字段是重建该产物的确切命令。",
        ],
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "models": models,
        "bakeInputs": inputs,
    }
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    if copied:
        for c in copied:
            print(f"  更新  {c}")
    else:
        print("  resources 已经是最新的")
    print(f"  清单  {rel(MANIFEST)}（{len(models)} 个模型）")

    if problems:
        print("\n还有问题没解决：")
        for p in problems:
            print("  - " + p)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
