# Garage scene with camera-jump navigation — design

**Date:** 2026-07-02
**Status:** Approved, implementing
**Asset:** `Test_Garage/test garage.glb` (Blender glTF I/O v4.5)

## Goal

Add a PS1-rendered scene that loads the garage GLB and lets the visitor **jump between the
three cameras baked into the file** with **smooth transitions**. Replaces the cube/rainbow
PS1 lab as the app's main view (PS1Lab kept parked).

## Asset facts (from GLB inspection)

- **Draco-compressed** (`KHR_draco_mesh_compression` — required). Needs a decoder.
- **3 perspective cameras**, yfov ≈ 0.8627 rad (~49.4°), znear 0.1, zfar 1000:
  - `Camera_Outside` — pos `[-13.49, 2.69, 1.31]`
  - `Camera_Inside` — pos `[-9.83, 5.09, 1.31]`
  - `Camera_Overhang` — pos `[-0.35, -1.72, 4.75]`
- **1 point light** (`KHR_lights_punctual`, intensity 54351 cd), **0 animations**.
- **20 materials** (Skoda Octavia + garage surfaces), almost all **flat baseColorFactor**;
  only **1** carries a texture. All double-sided.

## Approach

### Asset pipeline
- Copy GLB → `public/models/test-garage.glb` (tracked runtime asset).
- Copy three's Draco decoder → `public/draco/`; load via drei `useGLTF(url, '/draco/')`.
- `Test_Garage/` authoring folder (`.blend`, `assets/`) stays local → add to `.gitignore`.

### PS1 material extension (`ps1Material.ts`)
1. **Flat color OR texture:** add `uColor` + `uUseMap`; fragment uses `texture(uMap, uv)` when a
   map is present, else flat `uColor`. Base is then multiplied by the per-vertex light.
2. **Point light** in the shared uniforms: `uPointPosView` (vec3, view space), `uPointColor`,
   `uPointIntensity`. Per-vertex Lambert adds an inverse-square point term on top of ambient.
   Lighting is computed in **view space**: each frame the GLB light's world position is
   transformed by the active camera's view matrix and written to `uPointPosView` (stays correct
   while the camera moves; avoids per-mesh world-matrix math).

### Material conversion
On load, traverse `gltf.scene`; for each mesh read `.color` and `.map`, build a PS1 material
(`NearestFilter` on any map, `DoubleSide`), replace `mesh.material`.

### Camera jump controller (`cameraJump.ts`)
Read the 3 cameras' world `position` / `quaternion` / `fov` after mount. Drive the render camera
(the one `PS1Pipeline` already renders through). On `jump(i)`: capture start = current camera,
end = target[i]; animate `t: 0→1` over `duration` with **ease-in-out-cubic** — `position` lerp,
`quaternion` **slerp**, `fov` lerp. Straight-line move between the fixed cams. Camera transform +
`uPointPosView` are updated in a priority-0 `useFrame`; the pipeline renders at priority 1.

### Triggers (`CameraButtons.tsx` + `.module.css`)
DOM overlay (fixed corner, styled from `tokens.css`): **Outside / Inside / Overhang** buttons +
keys **1/2/3**. Active camera highlighted.

### Wiring
`App.tsx` → `GarageScene`. Reuse `PS1Pipeline`, `makeSharedUniforms`, post/dither material
unchanged. Leva keeps the effect controls; add a **Lighting** folder (normalized point-intensity
scale, since raw is 54351 cd) + a **transition duration** slider.

## Files
- new: `src/scenes/ps1/GarageScene.tsx`, `src/scenes/ps1/cameraJump.ts`,
  `src/scenes/ps1/CameraButtons.tsx` + `.module.css`
- edit: `src/scenes/ps1/ps1Material.ts`, `src/App.tsx`, `.gitignore`
- assets: `public/models/test-garage.glb`, `public/draco/*`

## Out of scope
- Animation playback (asset has none) — deferred to a later asset that includes animations.
- Clickable 3D hotspots — explicit buttons/keys for now.

## Verification
Puppeteer-core screenshot harness: capture each of the 3 cameras + a mid-transition frame;
confirm low-res chunky raster, Draco geometry present, and the point light actually shades.
