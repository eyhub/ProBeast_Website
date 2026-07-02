# CLAUDE.md

Guidance for agents working in this repo. Keep it concise; keep it committed.

## What we're building

A **point-and-click navigation 3D website** rendered in a **PS1 style**. The visitor moves
through the space by **jumping between fixed cameras** (click a hotspot → cut/tween to the next
camera), not by free-flying. The scene has **baked animations**, **a few dynamic lights**, and
uses the rendering pipeline defined in **[docs/ps1-rendering-pipeline.md](docs/ps1-rendering-pipeline.md)**.

The 3D scene is authored externally and delivered as an asset file. **Request GLB/GLTF** — it is
the only format that carries cameras, animations, and lights together. FBX is a fallback (drei
`useFBX`); OBJ is static-only (no cameras/animations/lights) and unsuitable for the main scene.

## Stack

- **three.js 0.185 + @react-three/fiber 9 + @react-three/drei 10 + @react-three/postprocessing 3.**
  Do **not** introduce Babylon.js or a second render engine — the PS1 look depends on the
  low-level shader/render-target control R3F/three gives us.
- **leva** for scene controls, **gsap** / **motion** for tweening.
- **Vite 6 / React 19 / TypeScript 6** (versions pinned for Node 22.11 — do not bump past the
  Node 22.12 engine wall without changing Node).
- Loaders (`GLTFLoader`, `useGLTF`, `useFBX`, `useAnimations`), `CameraControls`, and the Draco /
  meshopt decoders all ship with drei/three — **no new dependency is needed** for the features
  above. Consider `three-mesh-bvh` only if click-picking the full scene becomes slow.

## Feature → implementation map

- **Load scene:** drei `useGLTF`. If Draco/meshopt-compressed, put the decoder files in `public/`.
- **Animations:** drei `useAnimations` (wraps `AnimationMixer`).
- **Camera jumps:** read `gltf.cameras`; set the active camera per node, tween the cut with `gsap`
  (or drei `CameraControls`). Keep the transition short — this is "jump," not free-fly.
- **Point-click nav:** R3F raycasting (`onClick` on hotspot meshes / invisible colliders),
  `useCursor` for hover, drei `Html` for DOM labels.
- **Dynamic lights:** feed a small light array into the shared PS1 uniforms (extend the PS1
  material — it currently does one directional + ambient). Keep it to a few lights; PS1 is cheap
  by design.
- **PS1 look:** reuse the existing pipeline — do not re-derive it. See the guide.

## Conventions

- PS1 scenes live under `src/scenes/ps1/`; shared shader chunks under `src/scenes/ps1/shaders/`.
- Renderer: `antialias: false`, `dpr={1}`, `NoToneMapping`. Rasterize **low-res first**, then
  posterize + Bayer dither. Nearest textures, no mips, 64–256px source art. Fog color == clear
  color. (Full rationale + ranges in the guide.)
- Reuse [src/styles/tokens.css](src/styles/tokens.css) for any DOM UI; keep the 3D palette in-scene.
- `@/*` maps to `./src/*`.

## Commands

```bash
npm run dev        # Vite dev server
npm run build      # tsc -b && vite build
npm run typecheck  # tsc -b
npm run format     # prettier
```

## Verifying visuals

Use the puppeteer-core screenshot harness (scratchpad `shot*.cjs`, installed Chrome with GPU
flags) to confirm a scene actually rasterizes low-res and animates — eyeball the chunky pixels,
don't assume.

## Repo hygiene

Source art, exported GLB/OBJ, and Blender references are kept locally in **`archive/`**, which is
**gitignored** — do not commit it. Only the runtime scene asset that the app actually loads gets
tracked (added deliberately under `public/` or `src/` when wired in).
