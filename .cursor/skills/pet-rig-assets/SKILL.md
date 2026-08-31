---
name: pet-rig-assets
description: Generate a rigging-ready 2D pet base image and make its plain background transparent, producing clean source art for Spine / God Mode skeletal rigging in the WarmPet project. Use when preparing a pet character for 2D skeletal rigging, creating a new pet species or skin base image, removing a white/solid background from generated art, or when the user mentions 绑骨底图, 分件图, 去白底, rig base, or Spine asset prep.
disable-model-invocation: true
---

# Pet Rig Asset Prep

Produce clean, rigging-ready pet source art for 2D Spine rigging (via God Mode AI for the humanoid pet, or by hand in Spine for the quadruped). Selection conclusions, naming conventions, and tool pitfalls live in the `pet-2d-spine` rule — read it if unsure.

## Workflow

```
- [ ] 1. Generate the base image (rig-friendly pose)
- [ ] 2. Remove the plain background -> transparent PNG
- [ ] 3. Place into assets-src/concept/ and hand off to rigging
```

### 1. Generate the base image

Use the image generation tool. Keep the warm milk-tea palette (main fur `#D9BE96`, or the pet's own color), flat cel-shaded, clean crisp outline, plain flat off-white background, generous margins, full body head-to-feet.

**Humanoid main pet (front-facing)** prompt core:
> a cute chibi cartoon cat mascot, [color] tabby, facing front, symmetric A-pose. Both arms held clearly OUT and DOWN with an obvious gap between each arm and the torso (arms not touching the body). Limbs clearly segmented: distinct upper arm / forearm / rounded hand-paw (hands drawn larger and defined), distinct thigh / shin / paw; legs slightly apart. Big round head, big glossy eyes, tiny nose, curved tail to one side. Flat 2D cel-shaded, clean outline, NO drop shadow, plain off-white background, generous margins, no props, no weapons.

**Quadruped small pet (side profile)** prompt core:
> a cute chibi cartoon cat in a clean side profile (facing right), on all four legs, spine horizontal. All four legs visible and slightly separated front-to-back so each can be cut as a separate part; tail fully visible and away from the body; head and ears in clear profile. Flat 2D cel-shaded, clean outline, NO drop shadow, plain off-white background, generous margins.

**Hard requirements** (skip any and the AI split produces stubby / detached limbs):
- Humanoid = front view; quadruped = clean side profile.
- Limbs clearly SEPARATED from the body with a visible gap.
- Hands/paws larger and defined; limbs segmented and slightly elongated (not tiny stubs).
- NO drop shadow / cast shadow; plain flat background; full body with margins.

### 2. Remove the background

```bash
python scripts/remove_white_bg.py <in>.png <out>.png [--thresh 40]
```

Flood-fills the background inward from the four corners, so near-white areas INSIDE the character (cream belly, paws) are kept — a naive "all near-white -> transparent" would punch holes in them. Requires Pillow (`pip install pillow`). Raise `--thresh` if a halo remains, lower it if edges get eaten.

### 3. Place & hand off

- Save the transparent PNG to `assets-src/concept/<name>_rigbase.png` (`<name>` = pet_humanoid / pet_cat / pet_dog).
- Rig it: humanoid via God Mode `ai-spine-animation` (auto-rig); quadruped by hand in Spine (Raptor-style).
- Export Spine 4.2 → `assets/resources/spine/<name>/`.

## Notes

- God Mode has its own Auto-remove-background toggle; this script is for offline prep or non-God-Mode flows.
- Naming / animation / slot conventions and all tool pitfalls: see the `pet-2d-spine` rule.
