---
name: pet-rig-assets
description: Generate a rigging-ready 2D pet base image and make its plain background transparent, producing clean source art for Spine / God Mode skeletal rigging in the WarmPet project. Use when preparing a pet character for 2D skeletal rigging, creating a new pet species or skin base image, removing a white/solid background from generated art, or when the user mentions 绑骨底图, 分件图, 去白底, rig base, or Spine asset prep.
disable-model-invocation: true
---

# Pet Rig Asset Prep

Produce clean, rigging-ready pet source art for 2D Spine rigging. **This project ships one rig only: a quadruped shared by cat and dog** (the humanoid main-pet plan was dropped on 2026-09-07), so rigging is always by hand in Spine, Raptor-style — the AI auto-rig tools are humanoid-only and do not apply. Selection conclusions, naming conventions, and tool pitfalls live in the `spine-2d-pet` rule — read it if unsure.

## Workflow

```
- [ ] 1. Generate the base image (rig-friendly pose)
- [ ] 2. Remove the plain background -> transparent PNG
- [ ] 3. Place into assets-src/concept/ and hand off to rigging
```

### 1. Generate the base image

Use the image generation tool. Keep the warm milk-tea palette (main fur `#D9BE96`, or the pet's own color), flat cel-shaded, clean crisp outline, plain flat off-white background, generous margins, full body head-to-feet.

**Quadruped pet (side profile)** — the only form this project needs — prompt core:
> a cute chibi cartoon cat in a clean side profile (facing right), on all four legs, spine horizontal. All four legs visible and slightly separated front-to-back so each can be cut as a separate part; tail fully visible and away from the body; head and ears in clear profile. Flat 2D cel-shaded, clean outline, NO drop shadow, plain off-white background, generous margins.

**Hard requirements** (skip any and the split produces stubby / detached limbs):
- Clean side profile, spine horizontal, all four legs separated front-to-back.
- Limbs clearly SEPARATED from the body with a visible gap.
- Paws larger and defined; limbs segmented and slightly elongated (not tiny stubs).
- NO drop shadow / cast shadow; plain flat background; full body with margins.

> The former front-facing A-pose prompt was for the humanoid main pet. That plan is
> dropped — do not generate it, and do not treat
> `assets-src/concept/pet_humanoid_rigbase.png` as a deliverable input.

### 2. Remove the background

```bash
python scripts/remove_white_bg.py <in>.png <out>.png [--thresh 40]
```

Flood-fills the background inward from the four corners, so near-white areas INSIDE the character (cream belly, paws) are kept — a naive "all near-white -> transparent" would punch holes in them. Requires Pillow (`pip install pillow`). Raise `--thresh` if a halo remains, lower it if edges get eaten.

### 3. Place & hand off

- Save the transparent PNG to `assets-src/concept/<name>_rigbase.png` (`<name>` = pet_cat / pet_dog).
- Rig it by hand in Spine, Raptor-style (segmented spine + two-bone IK per leg + tail/ears). Cat and dog share the one rig, so a new species is a reskin, not a new rig.
- Export → `assets/resources/spine/<name>/`. **Match the engine's Spine version** — see the `spine-2d-pet` rule; the existing assets are 3.8.x and a mismatched runtime renders nothing.

## Notes

- `idle` must be an awake pose. It is the first animation the player sees on launch, and a sleeping cat reads as "it doesn't need me" (`PetStage.IDLE_CANDIDATES` keeps sleep poses last as a fallback only).
- Naming / animation / slot conventions and all tool pitfalls: see the `spine-2d-pet` rule.
