# Project History

Concise record of how this repo came to be. Basematter only — code and git log hold the detail.

## Origin

Started as an experimental **WebGL / three.js / React Three Fiber** suite for prototyping
high-fidelity UI, animation, and 3D scenes for ProBeast, with consistent CSS design tokens.
Now converging on a **PS1-style, point-and-click 3D navigation website** (see [CLAUDE.md](CLAUDE.md)).

## Stack decisions

- **Vite 6 + @vitejs/plugin-react 4 + React 19 + TypeScript 6**, pinned to versions that run on
  **Node 22.11** (Vite 8 / plugin-react 6 require Node ≥ 22.12 → `EBADENGINE`; downgraded to
  contain the fix locally rather than change the global Node).
- **3D:** `three` 0.185, `@react-three/fiber` 9, `@react-three/drei` 10,
  `@react-three/postprocessing` 3. **leva** for scene controls. `gsap` + `motion` for tweening.
- TypeScript 6 project references; no `baseUrl` (removed after TS6 `TS5101`/`TS5090`),
  `@/*` → `./src/*`.

## Design foundation

- **Design tokens** in [src/styles/tokens.css](src/styles/tokens.css) — brand palette
  (`--beast-petrol #00a99d`, `--beast-obsidian #06080a`), display font stack, easing curves,
  spacing, radii, durations.
- **Eurostile Extended** font was corrupt (bad cmap → Chrome OTS rejection, troika crash).
  Repaired with fonttools (cmap rebuilt from glyph names via AGL, hinting dropped) →
  `public/fonts/Eurostile-fixed.woff2` / `.ttf`.

## Hero animation (built, parked)

Multi-phase R3F hero: black → ASCII matrix rain building an isometric grid → light arc
solidifies a white-stroked cube lattice → center cube kept, others swept up → morph into the
logo cube → faces light petrol-green in sequence → settle. Files kept intact under
`src/components/Hero/`, `src/scenes/HeroCanvas.tsx`, `src/scenes/hero/`. Currently **not
mounted** (`App.tsx` renders the PS1 lab instead).

## PS1 rendering work

- **Guide:** [docs/ps1-rendering-pipeline.md](docs/ps1-rendering-pipeline.md) — the canonical
  reference for the PS1 look (low-res rasterization, vertex snapping, affine UV warp, posterize
  + Bayer dither, per-vertex lighting, fog), with parameter ranges and an agent checklist.
- **PS1 lab scene** under `src/scenes/ps1/`: shared PS1 `ShaderMaterial` (NDC vertex snap +
  affine-UV cancellation + per-vertex Lambert + fog), low-res FBO pipeline (`PS1Pipeline.tsx`),
  posterize/dither post material, a ground plane, a fixed-position cube whose **rotation** springs
  toward the cursor (underdamped → weighted feel), and a rotating **rainbow gradient background**
  rendered into the FBO so it inherits the PS1 treatment. All effects are leva-adjustable
  (pixelation, jitter, affine, quantize/dither, fog, nearest-filter).

## Tooling

- **Screenshot harness** (scratchpad `shot*.cjs`, puppeteer-core against installed Chrome with
  GPU flags) used throughout to verify scenes actually rasterize low-res and animate.

## Assets

- Source art, exported GLB/OBJ, and Blender references live in **`archive/`**, which is
  **gitignored** — kept locally for reference, not tracked in the repo. The runtime scene asset
  will be added deliberately under `public/` (or `src/`) when wired in.
