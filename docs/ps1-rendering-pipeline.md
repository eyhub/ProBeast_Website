# PS1‑Style Rendering Guide

A practical reference for building scenes with a **PlayStation 1‑era look** in this
repo's stack: **React Three Fiber + three.js 0.185 + drei + @react-three/postprocessing**.
Written for agents — copy the snippets, respect the parameter ranges, follow the checklist.

> The PS1 look is not "a filter." It is a **pipeline** of cooperating, period‑accurate
> limitations. Three of them carry 80% of the feel: **low‑res rasterization**,
> **vertex snapping (jitter)**, and **affine (non‑perspective) texture warping**. Get those
> three right before adding dithering, fog, and CRT polish.

---

## 1. What actually made the PS1 look that way

| # | Hardware reality | Visible result | Emulate with |
|---|------------------|----------------|--------------|
| 1 | Renders at ~256×224–640×480 (commonly **320×240**), no AA | Chunky pixels, hard edges | Rasterize the scene into a **low‑res render target**, upscale **nearest** |
| 2 | GTE used **fixed‑point integer** screen coords, no subpixel | **Vertex jitter / wobble** as things move | **Snap vertex NDC** to a coarse grid in the vertex shader |
| 3 | GPU did **no perspective correction** on UVs | Textures **warp / swim** on big near polys | **Affine UV** interpolation (cancel the w‑divide) |
| 4 | **15‑bit color** (5/5/5 = 32 levels/channel) + ordered dither | Banding masked by a fine dither pattern | **Posterize + 4×4 Bayer dither** in post |
| 5 | **Per‑vertex (Gouraud)** lighting, no normal maps | Flat, faceted shading; light "slides" on verts | `flatShading` + per‑vertex lighting, few lights |
| 6 | Small textures, **point sampling**, no mips | Crunchy, aliased textures | `NearestFilter`, `generateMipmaps = false`, 64–256px art |
| 7 | **No depth buffer** — painter's algo via ordering tables | Z‑sorting glitches, occasional pop | Usually *don't* emulate (we have a real z‑buffer); optional low‑precision depth |
| 8 | Tiny draw distance | Heavy **fog** hides pop‑in | `THREE.Fog` matched to the background |
| 9 | No subpixel + low res | Texture/edge **shimmer** in motion | Falls out of #1–#3 for free |

You almost never want #7. Emulate **1, 2, 3, 4, 6, 8** and you have it.

---

## 2. The pipeline, in order

```
PS1 material (vertex shader)            ── snapping + affine UV, per‑vertex light
        │
        ▼
Rasterize into a LOW‑RES render target  ── e.g. 320×240, NearestFilter, no AA, fog
        │
        ▼
Fullscreen upscale quad                 ── nearest sampling → screen
        │  (do these in the upscale shader, or as post effects)
        ├── posterize to ~32 levels
        ├── 4×4 ordered (Bayer) dither
        └── optional: scanlines / CRT / slight chromatic offset
```

**Critical:** rasterize at low resolution *first*. Snapping and affine warping must happen
at the low res so edges and texture seams are genuinely chunky. A post‑hoc `Pixelation`
effect on a hi‑res frame **softens** the result and is *not* equivalent.

---

## 3. The PS1 vertex shader (snapping + affine UV)

Use this as the shared vertex stage for every PS1 material. It does both the jitter and the
affine‑UV setup. Both effects are exposed as 0..1 strengths so the demo sliders can blend
them against the "correct" modern result.

```glsl
uniform vec2  uSnapResolution; // virtual screen res, e.g. vec2(320.0, 240.0)
uniform float uSnap;           // 0 = smooth, 1 = full PS1 jitter
uniform float uAffine;         // 0 = perspective‑correct, 1 = full affine warp

varying vec2  vUvPersp;        // perspective‑correct (default smooth interpolation)
varying vec2  vUvAffineW;      // uv * w  (see fragment)
varying float vW;              // w

void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

  // --- (2) Vertex snapping: quantise NDC.xy to the virtual pixel grid ---
  vec3 ndc = clip.xyz / clip.w;
  vec2 grid = uSnapResolution * 0.5;          // smaller grid = chunkier wobble
  vec2 snapped = floor(ndc.xy * grid) / grid;
  ndc.xy = mix(ndc.xy, snapped, uSnap);
  clip.xyz = ndc * clip.w;                    // back to clip space (keeps depth/clip correct)

  // --- (3) Affine UV: pass uv*w and w; the fragment divide cancels to screen‑linear ---
  vUvPersp   = uv;            // GPU interpolates this perspective‑correct
  vUvAffineW = uv * clip.w;   // perspective‑correct( uv*w ) / perspective‑correct( w ) == affine
  vW         = clip.w;

  gl_Position = clip;
}
```

**Why the affine trick works:** the rasterizer interpolates every varying
perspective‑correctly (it divides by `w`). If you premultiply the UV by `w` and also pass
`w`, then in the fragment `vUvAffineW / vW` algebraically **cancels** the perspective term,
leaving a pure screen‑linear (affine) UV — exactly what the PS1 did. Blending toward
`vUvPersp` gives you the strength knob.

```glsl
// fragment
uniform sampler2D uMap;
uniform float uAffine;
varying vec2 vUvPersp;
varying vec2 vUvAffineW;
varying float vW;

void main() {
  vec2 uvAffine = vUvAffineW / vW;          // screen‑linear UV
  vec2 uv = mix(vUvPersp, uvAffine, uAffine);
  gl_FragColor = texture2D(uMap, uv);
}
```

> ⚠️ **Affine + near clipping:** strong affine warps look most extreme on large polygons
> close to the camera (just like the real thing). Keep test geometry reasonably tessellated
> if a surface should *not* warp; subdivide floors/walls so each triangle is small.

---

## 4. Low‑resolution rasterization (R3F)

Render the scene into a small FBO, then draw that FBO to the screen on a fullscreen quad
with **nearest** sampling. drei's `useFBO` makes this clean.

```tsx
import { useFBO } from '@react-three/drei';
import { useFrame, useThree, createPortal } from '@react-three/fiber';
import { NearestFilter, Scene, OrthographicCamera as Ortho } from 'three';

function LowRes({ width = 320, height = 240, children }) {
  const target = useFBO(width, height, { minFilter: NearestFilter, magFilter: NearestFilter });
  const scene = useMemo(() => new Scene(), []);
  const { gl, camera } = useThree();

  useFrame(() => {
    gl.setRenderTarget(target);
    gl.render(scene, camera);     // render the low‑res world
    gl.setRenderTarget(null);     // back to default framebuffer
  }, 1);

  return (
    <>
      {createPortal(children, scene)}
      {/* draw target.texture on a fullscreen quad with the post shader (Section 5) */}
    </>
  );
}
```

Alternatives (pick per use‑case):
- **`@react-three/postprocessing` → `Pixelation`** effect: simplest, but it averages a
  hi‑res frame → softer, *less* authentic. Fine for a quick look, not for the real thing.
- **three's `RenderPixelatedPass`** (`three/examples/jsm/postprocessing`): faithful, but uses
  three's own `EffectComposer`, which doesn't compose with the `postprocessing` library —
  don't mix the two composers in one canvas.

Keep `gl={{ antialias: false }}` on the `<Canvas>`, and `dpr={1}`. No AA is correct.

---

## 5. Color quantization + ordered dithering (post / upscale shader)

Do this in the fullscreen upscale fragment shader (one pass, cheapest) or as a custom
`postprocessing` effect.

```glsl
uniform sampler2D uScene;
uniform float uLevels;   // color steps per channel; PS1 ≈ 32.0 (5‑bit)
uniform float uDither;   // 0..1 dither strength
varying vec2 vUv;

// 4×4 Bayer ordered‑dither matrix, normalised to roughly [-0.5, 0.5]
float bayer4x4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = y * 4 + x;
  float m[16];
  m[0]=0.;  m[1]=8.;  m[2]=2.;  m[3]=10.;
  m[4]=12.; m[5]=4.;  m[6]=14.; m[7]=6.;
  m[8]=3.;  m[9]=11.; m[10]=1.; m[11]=9.;
  m[12]=15.;m[13]=7.; m[14]=13.;m[15]=5.;
  return (m[i] + 0.5) / 16.0 - 0.5;
}

void main() {
  vec3 c = texture2D(uScene, vUv).rgb;
  vec2 pixel = gl_FragCoord.xy;          // screen pixel for the dither pattern
  float t = bayer4x4(pixel) * uDither;
  c += t / uLevels;                      // nudge before quantising
  c = floor(c * uLevels + 0.5) / uLevels; // posterize to uLevels steps
  gl_FragColor = vec4(c, 1.0);
}
```

For period accuracy, sample the dither against the **low‑res** pixel grid, not the upscaled
screen pixels — i.e. feed `floor(vUv * virtualRes)` into `bayer4x4` instead of
`gl_FragCoord.xy` so the dither dots are chunky too.

---

## 6. Lighting, materials, textures, fog

**Lighting (Gouraud / faceted):**
- Set `flatShading: true` on standard materials for the faceted PS1 silhouette.
- Prefer **per‑vertex** lighting: compute diffuse in the vertex shader and pass a color
  varying, or use `MeshLambertMaterial` (cheap, no specular) with **1–2 lights + ambient**.
- Avoid `MeshStandardMaterial`/PBR, normal maps, and environment maps — wrong era.

**Textures:**
```ts
tex.minFilter = NearestFilter;
tex.magFilter = NearestFilter;
tex.generateMipmaps = false;
tex.anisotropy = 1;
// author/resize source art to 64–256 px
```

**Fog (hide the short draw distance):**
```ts
scene.fog = new THREE.Fog(backgroundColorHex, near, far); // far ≈ where geometry should vanish
```
Match the fog color to the clear color so geometry dissolves into the void, PS1‑style.

**Renderer:** `antialias: false`, `dpr={1}`, tone mapping `NoToneMapping`, low‑res target.

---

## 7. Parameter ranges (for the demo sliders / toggles)

| Control | Type | Range | PS1 default | Notes |
|---|---|---|---|---|
| Internal resolution | slider | 96–640 px (height) | **240** | The single biggest knob; lower = more PS1 |
| Vertex snap (`uSnap`) | slider | 0–1 | **1.0** | Tie grid to internal res; 0 = modern |
| Affine warp (`uAffine`) | slider | 0–1 | **1.0** | Most visible on large near polys |
| Color levels (`uLevels`) | slider | 8–64 | **32** | 32 = 5‑bit; 16 = extra crunchy |
| Dither (`uDither`) | slider | 0–1 | **1.0** | Use the low‑res grid for chunky dots |
| Fog far | slider | 5–60 (world u) | scene‑scaled | Pair with matching fog color |
| Flat shading | checkbox | — | **on** | Faceted look |
| Nearest textures | checkbox | — | **on** | vs. linear for comparison |
| Jitter / affine / dither / scanlines | checkboxes | — | on | Toggle each effect independently |

In this repo, expose these with **`leva`** (already installed): `useControls` →
`{ value, min, max, step }` for sliders, `boolean` for checkboxes. Drive the shader uniforms
from the returned values in `useFrame`.

---

## 8. Integrating with this repo

- Put PS1 scenes under `src/scenes/ps1/` and shared shader chunks in
  `src/scenes/ps1/shaders/`.
- Reuse the design tokens for any DOM UI ([src/styles/tokens.css](../src/styles/tokens.css));
  keep the 3D palette inside the scene.
- The hero's screenshot harness (headless Chrome, see the scratchpad `shot*.cjs` scripts)
  is the way to verify a PS1 scene actually rasterizes low‑res — eyeball the chunky pixels.
- `leva` for controls, `@react-three/postprocessing` for the dither/scanline pass (or fold it
  into the upscale quad shader for one fewer pass).

---

## 9. Pitfalls

- **Pixelating in post ≠ low‑res rasterization.** Render the world small; don't blur a big
  frame. (Section 4.)
- **Affine breaks on huge triangles behind the near plane.** Subdivide large surfaces; the
  PS1 had the same artifact, so a little is authentic, a lot is broken.
- **Snapping needs the *virtual* resolution**, not the screen resolution — otherwise there's
  no visible wobble on a 4K display.
- **Don't double‑filter.** Nearest textures + nearest upscale; linear anywhere reintroduces
  smoothing and kills the look.
- **Tone mapping / sRGB**: keep colors flat (`NoToneMapping`); PS1 had no HDR. Quantize in
  the same space you display.
- **Performance**: low‑res target is *cheaper*, not more expensive — lean into it.

---

## 10. Agent checklist

- [ ] Scene renders into a low‑res FBO (≈320×240), `NearestFilter`, upscaled nearest.
- [ ] `antialias: false`, `dpr={1}`, `NoToneMapping`.
- [ ] All PS1 materials share the snap+affine vertex shader; strengths are uniforms.
- [ ] `uSnapResolution` matches the internal render size.
- [ ] Posterize (~32 levels) + 4×4 Bayer dither, sampled on the low‑res grid.
- [ ] `flatShading: true`, per‑vertex/Lambert lighting, ≤2 lights + ambient.
- [ ] Textures: nearest, no mips, 64–256px source.
- [ ] Fog color == clear color; far clip tuned for short draw distance.
- [ ] Every effect is individually toggleable and strength‑adjustable (leva).

---

## References

- PlayStation GPU/GTE behavior: fixed‑point vertices, no perspective correction, 15‑bit
  framebuffer, no depth buffer (ordering tables).
- three.js: `WebGLRenderTarget`, `NearestFilter`, `Fog`, `flatShading`, `RenderPixelatedPass`.
- Standard affine‑UV cancellation trick (premultiply UV by `w`, divide in fragment).
- Ordered dithering: 4×4 Bayer threshold matrix.
