# PRD — PS1 Pipeline: Material & Animation Extensions

**Date:** 2026-07-03
**Status:** Ready for implementation
**Intended executor:** larger coding model (implementation pass)
**Repo:** ProBeast_Website · PS1 scene stack (three 0.185 · R3F 9 · drei 10 · @react-three/postprocessing 3)

> Self-contained: captures the current pipeline, the limitations to remove, and precise
> requirements. Read [docs/ps1-rendering-pipeline.md](../ps1-rendering-pipeline.md) for the PS1 look
> rationale. Do **not** re-derive the pipeline — extend it.

---

## 1. Goal

Extend the PS1 pipeline so more of what's authored in Blender / carried in glTF survives, **and** add
character animation via a **baking-first** strategy (no runtime GPU skinning in the core scope):

- **Materials:** flat color (exists) + **vertex colors (COLOR_0)** + **emissive** + **glass/transparency**.
- **Animation:** an `AnimationMixer` for **node/TRS** clips (props, doors, and rigid characters).
- **Characters (humanoids + animals) — SMOOTH deformation required:** rig & skin **normally in
  Blender** (smooth weights, shape keys, whatever), then **bake the deformation to Vertex Animation
  Textures (VAT)**. The runtime replays the smooth result from a texture with **no runtime skinning**.

**Why baking:** the PS1 had no hardware skinning; characters were animated with pre-baked
vertex/keyframe animation. For this **point-and-click / camera-jump** site, characters are ambient
loopers (idle/walk/pace) that need no runtime blending or IK — the ideal case for baking. VAT bakes
the *final vertex positions* Blender produces, so **all rigging/skinning stays in Blender** and we
still **keep the current custom shader (Option A)** — no material-layer rewrite, no lighting re-tune.

**Note — morph is subsumed:** because VAT bakes final vertex positions regardless of what drives them
(armature *or* shape keys), facial/blendshape animation bakes into VAT too. So **glTF morph targets
are not needed** in core scope.

**Non-goals (core):** runtime skeletal skinning, glTF morph targets, normal maps, metallic/roughness
PBR, HDRI/environment lighting, multi-light arrays. Real runtime skinning + morph are preserved as an
**optional appendix** (§10) only for a future need of many *interactively-blended* characters.

---

## 2. Current state (what exists today)

**Pipeline** (`src/scenes/ps1/`):
- `PS1Pipeline.tsx` — portals children into an offscreen `worldScene`, renders it through the active
  camera into a **low-res FBO** (`useFBO`, NearestFilter), then draws a fullscreen quad with the post
  material. Manual render at `useFrame(..., 1)` (priority 1); R3F auto-render is disabled.
- `postMaterial.ts` — fullscreen posterize (`uLevels`) + 4×4 **Bayer dither** on the low-res grid.
- `ps1Material.ts` — the per-surface **custom GLSL3 `ShaderMaterial`**:
  - Vertex: NDC **vertex snapping** (`uSnapAmt`, `uSnapRes`), **affine UV** setup
    (`vUvP`, `vUvA = uv*w`, `vW`), **per-vertex Gouraud lighting** into `vColor`
    (`uAmbient` + dim directional + one **view-space point light** `uPointPosView/Color/Intensity`),
    linear **fog** into `vFog`.
  - Fragment: `base = mix(uColor, texture(uMap,uv).rgb, uUseMap)`, `col = base * vColor`,
    `col = mix(uFogColor, col, vFog)`, **alpha forced to 1**.
  - `createPS1Material(shared, {map,color,doubleSided})` and `ps1MaterialFromStandard(shared, source)`
    — the latter reads **only** `source.color` (`baseColorFactor`, linear→sRGB) and `source.map`.
- `GarageScene.tsx` — loads the Draco GLB, `gltf.scene.clone(true)`, then a traverse that swaps every
  mesh material via a **dedup cache** `Map<sourceMaterial, ShaderMaterial>`. Reads 3 cameras
  (`cameraJump.ts`) + first point light; drives the render camera with `CameraTween`.

**Confirmed limitations to remove** (GLB inspection of `public/models/test-garage.glb`):
- Shader consumes only `baseColorFactor` + first `baseColorTexture` + `doubleSided`.
- Dropped: vertex colors (`COLOR_0`/`COLOR_1` ARE present), emissive, alpha/transmission, PBR, normals.
- **No `AnimationMixer`** wired — clips wouldn't play.

---

## 3. Architecture decision — RESOLVED: Option A (keep the custom shader)

Because character animation is delivered by **baking** (rigid TRS / VAT), we do **not** need three's
skinning or morph machinery, so there's no reason to re-base the material on a three built-in. **Keep
the hand-written GLSL3 `ShaderMaterial`.** Consequences locked in by this choice:

- ✅ No material-layer rewrite; shader stays a single readable file.
- ✅ Keep **per-vertex Gouraud** lighting and the single **custom view-space point light** — the
  garage look we tuned (ambient `#434e57`, dim fill, point intensity 25) is **not** disturbed.
- ✅ Not coupled to three's internal shader chunks (no `onBeforeCompile` fragility on three upgrades).
- ➕ Material features (WS1–3) and VAT (WS6) are added **directly** to the custom shader.

Escape hatch: if real skinning/morph is ever required, see **Appendix A** (hybrid: patch a
`MeshBasicMaterial` for skinned meshes only, keeping this shader everywhere else).

---

## 4. Requirements — Materials

### WS1 — Vertex colors (COLOR_0)
**Requirement:** meshes with a `color` attribute multiply base color by the (linear→sRGB) vertex color.
**Approach:**
- Detect per **geometry**: `geometry.hasAttribute('color')` (per-mesh, not per-material).
- Custom shader: gate with a define so meshes without the attribute are unaffected —
  `#ifdef USE_VCOLOR in vec3 color; #endif` and multiply into `base`. Set the define on the material
  variant used by colored meshes (or set `material.vertexColors = true`, which makes three emit
  `USE_COLOR` and bind the attribute; then read it in the fragment/vertex).
- COLOR_0 may be `vec3` or `vec4` (Blender often vec4) — handle/ignore alpha. glTF vertex colors are
  **linear**; convert to the shader's working space consistently.
**Files:** `ps1Material.ts`, dedup logic in `GarageScene.tsx`.
**Acceptance:** `VertexColorTest.glb` shows the gradient; flat-color meshes unchanged.

### WS2 — Emissive
**Requirement:** support `emissiveFactor`, `emissiveTexture`, `KHR_materials_emissive_strength`
(→ `material.emissiveIntensity`) as unlit glow (PS1 lit-screen/sign look).
**Approach:** read `source.emissive`, `emissiveIntensity`, `emissiveMap`. Shader:
`col = base * vColor + emissive * emissiveIntensity` **before** the fog mix (distant emitters fade).
Per-material (fits dedup cache); linear→sRGB. Add a global leva **emissive boost**.
**Files:** `ps1Material.ts`, `GarageScene.tsx`, leva.
**Acceptance:** `EmissiveStrengthTest.glb` emitters glow at varying strengths; non-emissive unchanged.

### WS3 — Glass / transparency
**Requirement:** alpha transparency + a **cheap PS1 glass approximation** — **tinted-alpha only, no
physical refraction** (decision locked, §11).
**Approach:**
- **Alpha blend:** if `alphaMode==='BLEND'` or `baseColorFactor.a<1`, output real alpha, set
  `material.transparent=true`, `depthWrite=false`. three depth-sorts transparents within
  `gl.render(worldScene, camera)`.
- **`KHR_materials_transmission`:** approximate as tinted alpha, e.g.
  `opacity = clamp(1 - transmissionFactor*0.85, 0.1, 1)`; no screen refraction / no transmissionMap.
- **`alphaMode==='MASK'`:** `discard` below `alphaCutoff`.
- Keep fog on RGB; carry alpha to `fragColor.a`. Transparency composites into the low-res FBO, so it
  still posterizes/dithers — verify glass edges read as intentional.
**Files:** `ps1Material.ts` (alpha out + flags), `GarageScene.tsx` (read alphaMode/transmission).
**Acceptance:** `TransmissionTest.glb` (or a simple alpha cube) shows geometry through glass; opaque
set unaffected; no z-fighting.
**Risk:** double-sided transparent sorting is imperfect — acceptable for PS1; document it.

---

## 5. Requirements — Animation

### WS4 — AnimationMixer + node/TRS clips (foundation)
**Requirement:** play glTF clips that key node translate/rotate/scale — props, doors, **rigid
characters** (WS5), and (stretch) cameras.
**Approach:** drei **`useAnimations(gltf.animations, root)`** on the cloned scene root; expose
actions. Leva/UI to select + play/pause + speed + autoplay. drei updates the mixer at priority 0
(before the priority-1 pipeline render) — confirm ordering, else drive `mixer.update(dt)` in the
existing GarageScene priority-0 frame. **Works with the current shader unchanged** (TRS animates
transforms, read via `modelViewMatrix`).
**Files:** `GarageScene.tsx` (+ optional `useSceneAnimations.ts`), leva.
**Acceptance:** `BoxAnimated.glb` translates/rotates on load; PS1 snap/fog intact.

### WS5 — Rigid / segmented TRS animation (props / mechanical only)
**Requirement:** mechanical/segmented motion (garage door, car parts, fans, tools, robots) via node
TRS — no skin, no shader work. **Not** the humanoid/animal path (those need smooth deformation → WS6).
**Approach (runtime):** none beyond WS4 — the mixer plays the TRS clip; the current shader renders it.
**Authoring (Blender → glTF), skin-free:** parent rigid parts into a hierarchy and keyframe rotations
(or Bone-parent, not *Armature Deform*). Export must contain `animations` targeting node TRS and
`skins: []`. **Verification gate:** `glbfull.cjs` must report `skins: 0`.
**Acceptance:** a segmented prop plays its clip with correct part rotations; GLB has no skin; PS1 traits intact.

### WS6 — Vertex Animation Textures / VAT (PRIMARY character path — smooth deformation)
**Requirement:** smooth-deforming humanoids/animals **without** runtime skinning, **keeping the custom
shader**. You rig/skin in Blender as usual; VAT bakes the deformation to textures.

**Blender authoring workflow (all in Blender):**
1. Rig + skin the character normally (armature + smooth weights, and/or shape keys). This is where the
   **smoothness** comes from — it's real Blender skinning, just baked.
2. Author the clips you need (idle, walk, …) via actions/NLA.
3. Ensure **constant topology across all frames** (no remesh / dynamic subdiv / booleans / decimate
   that change vertex count or order). VAT requires a stable vertex order.
4. Run the **VAT bake script** (below): per frame, take the *evaluated* mesh and write each vertex's
   position (and normal) into an image; assign each vertex a stable **ID** in a spare UV channel.
5. Export the **rest-pose mesh as a static GLB** (no armature, no animation, WITH the ID UV channel) +
   the **VAT position/normal images**. The GLB is tiny and skin-free.
6. Drop GLB + textures into `public/models/`; the runtime plays them by time (no AnimationMixer).

**Bake tooling — Blender (per "everything on Blender"):** a **custom Blender Python script** is
recommended for full control of the data contract (a Blender VAT addon is acceptable if its layout is
documented and matched in-shader). The script: for each frame `f` in range, `obj.evaluated_get(depsgraph)
.to_mesh()`, read `V` vertex coords (+ normals), write to image row `f`; set `uv_id[i].x = (i+0.5)/V`.

**Data-layout contract (baker ↔ shader MUST agree):**
- **Position texture:** size `V × F` (column = vertex id, row = frame). Encoding: **32-bit float
  (OpenEXR)** for exact positions — WebGL2/GLSL3 supports float textures + **vertex texture fetch** —
  OR 16-bit PNG with a global **min/max remap** (`uVatBounds`) if float is inconvenient. `NearestFilter`,
  no mips.
- **Normal texture:** same layout, normals `[-1,1]→[0,1]` (needed so lighting follows the deformation).
- **Vertex ID:** stored in UV channel 1 as `u = (index+0.5)/V`. (Alternatively `gl_VertexID` under
  GLSL3, but the ID-UV is more robust to attribute reordering — prefer it.)
- **Frame:** `uFrame ∈ [0, F-1]`, fractional; sample rows `floor` and `floor+1`, `lerp`.

**Shader add (custom vertex shader), gated by `USE_VAT`:** uniforms `uVatPos` (sampler2D),
`uVatNrm`, `uVatSize` (vec2), `uFrame` (float), `uVatBounds` (if remapped). Before the existing
snap/affine/light: sample+lerp position at the vertex's ID → `animatedPosition`; replace `position`;
sample+lerp normal. Then `modelViewMatrix → snap → affine → Gouraud lighting` proceeds unchanged, so
you get **smooth deformation + PS1 jitter + fog** together. Make frame interpolation a toggle (off =
choppier, more authentic PS1 cadence).

**Clips:** bake frame ranges into one atlas; select via `uClipStart/uClipLength`; drive `uFrame` from
time in a priority-0 `useFrame`. Gate with a `USE_VAT` define so non-VAT meshes are unaffected
(dedup key includes VAT).

**Files:** `ps1Material.ts` (VAT vertex path), `vat.ts` (texture load + uniforms + EXR/PNG decode),
`GarageScene.tsx` (wire VAT meshes), `public/models/` (baked textures), a Blender bake script committed
under `tools/` or documented in `docs/`.
**Acceptance:** a VAT-baked walk loops with **smooth** deformation; baked normals light correctly; PS1
traits intact; the custom shader and garage look unchanged.
**Effort:** the Blender bake script + data contract is the bulk; the runtime shader add is small.
**Watch:** keep vertex counts PS1-modest (texture size = `V × F`); EXR needs three's `EXRLoader`
(ships with three examples) — wire it in `vat.ts`.

---

## 6. Cross-cutting concerns

- **Dedup cache key.** Extend from `sourceMaterial.uuid` to
  `sourceMaterial.uuid | vc:<hasColor> | vat:<isVat>` (these are per-geometry / force distinct
  programs). No skin/morph flags needed in core scope.
- **Clone.** `gltf.scene.clone(true)` is fine (no `SkinnedMesh` in core). `SkeletonUtils.clone` only
  matters in Appendix A.
- **Color space.** Base color, vertex color, and emissive must all convert the same way (current flat
  path does linear→sRGB). Document the choice in `ps1Material.ts`.
- **Transparency + FBO.** Transparents composite into the low-res FBO before the post pass — confirm
  sort order and that dithered glass edges look intentional.
- **Fog.** Emissive added before fog; alpha carried independently.
- **Render ordering.** Mixer / VAT time updates at priority 0 (before the priority-1 pipeline render),
  coherent with the existing point-light view-space update.
- **Leva:** emissive boost; transparency debug toggle; animation clip selector + play/pause + speed;
  VAT interpolation on/off. Group under existing folders.

---

## 7. Files in scope

- `src/scenes/ps1/ps1Material.ts` — vertex color, emissive, alpha, VAT vertex path (all additive).
- `src/scenes/ps1/GarageScene.tsx` — dedup key, per-mesh flag detection, mixer, leva, reading
  emissive/alpha from source materials, VAT wiring.
- `src/scenes/ps1/useSceneAnimations.ts` (new, optional) — mixer/actions hook.
- `src/scenes/ps1/vat.ts` (new) — VAT texture load + uniform helpers.
- `src/scenes/ps1/PS1Pipeline.tsx` — likely unchanged (verify transparent sorting via manual render).
- `docs/ps1-rendering-pipeline.md` — update materials/lighting + add an animation/VAT section.
- `docs/` — short Blender authoring note for rigid-TRS characters (skin-free export).

---

## 8. Test assets & verification

Fixtures (Khronos glTF-Sample-Assets + our own) into a gitignored `archive/test-gltf/`, loaded via a
temporary leva switch/route:

| Feature | Fixture |
|---|---|
| Vertex colors | `VertexColorTest.glb` |
| Emissive | `EmissiveStrengthTest.glb` |
| Transparency / glass | `TransmissionTest.glb` (or a simple alpha-blend cube) |
| Node/TRS anim | `BoxAnimated.glb` |
| Rigid character | a segmented humanoid authored per WS5 (skin-free) |
| VAT | a baked walk cycle per WS6 |

**Loop:** puppeteer-core screenshot harness (scratchpad `*.cjs`, installed Chrome + GPU flags) —
capture each fixture, confirm the effect **and** intact PS1 traits (chunky raster, dither, affine
warp, fog). Re-shoot the garage scene (all 3 cameras) to confirm **no regression**. `npm run build`
(`tsc -b && vite build`) must stay green.

---

## 9. Suggested sequencing

0. **Define the VAT data contract first** (texture layout, encoding, ID source) — it's the long pole
   and lets the Blender bake script and the runtime shader be built in parallel to the same spec.
1. WS4 (mixer + TRS) — smallest; unblocks props + camera paths; validates frame ordering.
2. WS1 (vertex colors) + WS2 (emissive) — cheap material wins; validate dedup-key changes.
3. WS3 (glass/transparency) — validate FBO transparency + dither.
4. **WS6 (VAT)** — the character path (required): Blender bake script + `vat.ts` + shader add. Highest
   new effort; start the bake script early (step 0) since art + tooling is the long pole.
5. WS5 (rigid TRS) — trivial once WS4 exists; apply to mechanical props as needed.
6. Update `docs/ps1-rendering-pipeline.md`; re-shoot garage for regressions.

---

## 10. Appendix A — Optional: real skeletal skinning + morph (NOT in core scope)

Only if the project later needs many characters with **interactive/blended** animation (baking can't
blend arbitrary clips at runtime). Recommended as a **hybrid** to limit blast radius:

- Keep the custom PS1 shader for the **entire environment**; use it for everything non-skinned.
- For **skinned meshes only**, use a three built-in material patched via `onBeforeCompile` (base on
  **`MeshBasicMaterial`** so three provides skinning/morph/vertex-colors/alpha/fog for free while we
  inject our **own per-vertex Gouraud light + snap + affine**, preserving the look).
- **Blocking:** replace `clone(true)` with **`SkeletonUtils.clone`** (`three-stdlib`) for skinned
  subtrees, or bindings break. Dedup key must add `skin`/`morph` flags.
- Drive with the same `AnimationMixer` (WS4). Morph = `morphTargetInfluences` (mixer-driven).
- **Cost:** couples the character material to three's shader internals (three-version fragility);
  re-tune only the character lighting, not the environment.

---

## 11. Decisions & open questions

**Resolved:**
1. **Character path → VAT (WS6).** Smooth deformation is required, so rigid TRS (WS5) is for
   props/mechanical only; humanoids/animals use VAT.
2. **VAT tooling → Blender.** Custom Blender Python bake script recommended (addon acceptable if its
   layout is documented and matched in-shader). All authoring stays in Blender.
3. **Morph → not needed.** Facial/blendshape animation bakes into VAT (it captures final vertex
   positions from shape keys too). Runtime morph stays in Appendix A only.
4. **Glass fidelity → tinted-alpha only (WS3).** No screen-space refraction. Glass = tinted,
   semi-transparent, alpha-blended surfaces — period-accurate and cheap. Refraction is not a
   future requirement.

**Still open:**
- **VAT encoding** — 32-bit EXR (exact, needs `EXRLoader`) vs 16-bit PNG + min/max remap? Recommend
  EXR for quality; confirm the target's tolerance for the extra loader + file size.
