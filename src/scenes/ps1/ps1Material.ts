import {
  Color,
  DataTexture,
  DoubleSide,
  GLSL3,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  Vector3,
  type IUniform,
  type Material,
  type Texture,
} from 'three';

/**
 * COLOR SPACE DECISION (keep consistent — see PRD §6):
 * The PS1 shader works in *display (sRGB) values* end-to-end: no colorspace transform is
 * appended to custom ShaderMaterials, so what we write is what the post pass quantizes.
 * Therefore every color input is converted linear → sRGB exactly once:
 *   - flat base color / emissive factor: CPU-side `Color.convertLinearToSRGB()`
 *   - vertex colors (glTF COLOR_0 is linear): in-shader `pow(c, 1/2.2)` approximation
 *   - textures: authored/marked sRGB, sampled as-is (matches the tuned garage look)
 */

/** Uniforms shared across every PS1 surface (one object, referenced by all materials). */
export interface SharedUniforms {
  uSnapRes: IUniform<Vector2>;
  uSnapAmt: IUniform<number>;
  uAffineAmt: IUniform<number>;
  uLightDir: IUniform<Vector3>;
  uLightColor: IUniform<Color>;
  uAmbient: IUniform<Color>;
  // Single dynamic point light, position supplied in VIEW space (see GarageScene).
  uPointPosView: IUniform<Vector3>;
  uPointColor: IUniform<Color>;
  uPointIntensity: IUniform<number>;
  /** Global multiplier on all emissive terms (leva "emissive boost"). */
  uEmissiveBoost: IUniform<number>;
  uFogColor: IUniform<Color>;
  uFogNear: IUniform<number>;
  uFogFar: IUniform<number>;
}

export function makeSharedUniforms(): SharedUniforms {
  return {
    uSnapRes: { value: new Vector2(320, 240) },
    uSnapAmt: { value: 1 },
    uAffineAmt: { value: 1 },
    // Directional term is a dim fill; the point light does the real work.
    uLightDir: { value: new Vector3(5, 8, 4).normalize() },
    uLightColor: { value: new Color('#333d45') },
    uAmbient: { value: new Color('#434e57') },
    uPointPosView: { value: new Vector3(0, 0, 0) },
    uPointColor: { value: new Color('#ffffff') },
    uPointIntensity: { value: 25 },
    uEmissiveBoost: { value: 1 },
    uFogColor: { value: new Color('#06080a') },
    uFogNear: { value: 4 },
    uFogFar: { value: 38 },
  };
}

/** 1×1 white fallback so samplers are always valid, even when a map is absent. */
const whiteTexture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat);
whiteTexture.needsUpdate = true;

const vertexShader = /* glsl */ `
  uniform vec2 uSnapRes;
  uniform float uSnapAmt;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform vec3 uAmbient;
  uniform vec3 uPointPosView;
  uniform vec3 uPointColor;
  uniform float uPointIntensity;

  // --- VAT (Vertex Animation Texture) playback — PRD WS6.
  // Deforms BEFORE snap/affine/lighting, so PS1 traits apply to the animated result.
  #ifdef USE_VAT
    in float vatId;               // (index + 0.5) / V — column into the VAT textures
    uniform sampler2D uVatPos;    // V x F, texel = object-local position (float)
    uniform sampler2D uVatNrm;    // V x F, texel = vertex normal (raw [-1,1])
    uniform float uVatFrames;     // F
    uniform float uVatFrame;      // fractional current frame (wraps)
    uniform float uVatLerp;       // 1 = interpolate frames, 0 = stepped (choppy PS1 cadence)
    uniform float uVatHasNrm;
  #endif

  out vec2 vUvP;   // perspective-correct uv
  out vec2 vUvA;   // uv * w  (affine numerator)
  out float vW;
  out vec3 vColor; // per-vertex (Gouraud) light
  out vec3 vVCol;  // vertex color (1,1,1 when the mesh has none)
  out float vFog;

  void main() {
    vec3 pos = position;
    vec3 nrm = normal;

    #ifdef USE_VAT
      float f0 = floor(uVatFrame);
      float t = fract(uVatFrame) * uVatLerp;
      float v0 = (mod(f0, uVatFrames) + 0.5) / uVatFrames;
      float v1 = (mod(f0 + 1.0, uVatFrames) + 0.5) / uVatFrames;
      pos = mix(texture(uVatPos, vec2(vatId, v0)).xyz, texture(uVatPos, vec2(vatId, v1)).xyz, t);
      if (uVatHasNrm > 0.5) {
        nrm = normalize(mix(
          texture(uVatNrm, vec2(vatId, v0)).xyz,
          texture(uVatNrm, vec2(vatId, v1)).xyz, t));
      }
    #endif

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vec4 clip = projectionMatrix * mv;

    // (2) vertex snapping in NDC → integer-ish grid → PS1 jitter
    vec3 ndc = clip.xyz / clip.w;
    vec2 grid = uSnapRes * 0.5;
    vec2 snapped = floor(ndc.xy * grid) / grid;
    ndc.xy = mix(ndc.xy, snapped, uSnapAmt);
    clip.xyz = ndc * clip.w;

    // (3) affine uv setup — fragment divides vUvA by vW, cancelling perspective
    vUvP = uv;
    vUvA = uv * clip.w;
    vW = clip.w;

    // vertex color (glTF COLOR_0, linear) → display space; three declares the
    // attribute + USE_COLOR/USE_COLOR_ALPHA when material.vertexColors is set
    vVCol = vec3(1.0);
    #ifdef USE_COLOR_ALPHA
      vVCol = pow(color.rgb, vec3(1.0 / 2.2));
    #elif defined( USE_COLOR )
      vVCol = pow(color, vec3(1.0 / 2.2));
    #endif

    // (5) per-vertex Gouraud lighting, computed in VIEW space
    vec3 n = normalize(normalMatrix * nrm);
    float dirDiff = max(dot(n, normalize(uLightDir)), 0.0);           // dim directional fill
    vec3 toLight = uPointPosView - mv.xyz;                            // view-space point light
    float dist2 = dot(toLight, toLight);
    float ptDiff = max(dot(n, normalize(toLight)), 0.0) * uPointIntensity / max(dist2, 0.01);
    vColor = uAmbient + uLightColor * dirDiff + uPointColor * ptDiff;

    // (8) linear fog by view depth (1 near, 0 far)
    float dist = -mv.z;
    vFog = clamp((uFogFar - dist) / (uFogFar - uFogNear), 0.0, 1.0);

    gl_Position = clip;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uUseMap;            // 1 = sample uMap, 0 = flat uColor
  uniform vec3 uColor;              // flat base color (display/sRGB values)
  uniform vec3 uEmissive;           // emissive factor (display/sRGB values)
  uniform float uEmissiveIntensity; // includes KHR_materials_emissive_strength
  uniform sampler2D uEmissiveMap;
  uniform float uUseEmissiveMap;
  uniform float uEmissiveBoost;     // shared/global (leva)
  uniform float uOpacity;           // 1 = opaque; <1 = tinted-alpha glass (PRD WS3)
  uniform float uAlphaTest;         // >0 = MASK mode cutoff
  uniform float uAffineAmt;
  uniform vec3 uFogColor;

  in vec2 vUvP;
  in vec2 vUvA;
  in float vW;
  in vec3 vColor;
  in vec3 vVCol;
  in float vFog;

  out vec4 fragColor;

  void main() {
    vec2 uvAffine = vUvA / vW;
    vec2 uv = mix(vUvP, uvAffine, uAffineAmt);
    vec4 texel = texture(uMap, uv);
    vec3 base = mix(uColor, texel.rgb, uUseMap) * vVCol;
    float alpha = uOpacity * mix(1.0, texel.a, uUseMap);
    if (uAlphaTest > 0.0 && alpha < uAlphaTest) discard;

    // emissive: unlit glow, added BEFORE fog so distant emitters still fade out
    vec3 emissive = uEmissive * mix(vec3(1.0), texture(uEmissiveMap, uv).rgb, uUseEmissiveMap)
                    * uEmissiveIntensity * uEmissiveBoost;

    vec3 col = base * vColor + emissive;
    col = mix(uFogColor, col, vFog);
    fragColor = vec4(col, alpha);
  }
`;

/** VAT playback data for one mesh (see vat.ts + tools/bake_vat.py for the contract). */
export interface VatOptions {
  position: Texture;
  normal?: Texture | null;
  frames: number;
}

export interface PS1MaterialOptions {
  map?: Texture | null;
  color?: Color;
  doubleSided?: boolean;
  /** Multiply base by the geometry's COLOR_0 attribute (three binds it as `color`). */
  vertexColors?: boolean;
  emissive?: Color;
  emissiveIntensity?: number;
  emissiveMap?: Texture | null;
  /** <1 (or transparent) → alpha-blended, depthWrite off — the PS1 "glass" look. */
  opacity?: number;
  transparent?: boolean;
  /** >0 → alphaMode MASK: discard below this cutoff. */
  alphaTest?: number;
  vat?: VatOptions;
}

export function createPS1Material(
  shared: SharedUniforms,
  opts: PS1MaterialOptions = {}
): ShaderMaterial {
  const map = opts.map ?? null;
  const emissiveMap = opts.emissiveMap ?? null;
  const opacity = opts.opacity ?? 1;
  const transparent = opts.transparent ?? opacity < 1;

  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader,
    side: opts.doubleSided ? DoubleSide : undefined,
    transparent,
    depthWrite: !transparent,
    vertexColors: opts.vertexColors ?? false,
    defines: opts.vat ? { USE_VAT: '' } : undefined,
    uniforms: {
      ...shared,
      uMap: { value: map ?? whiteTexture },
      uUseMap: { value: map ? 1 : 0 },
      uColor: { value: opts.color ?? new Color('#ffffff') },
      uEmissive: { value: opts.emissive ?? new Color('#000000') },
      uEmissiveIntensity: { value: opts.emissiveIntensity ?? 1 },
      uEmissiveMap: { value: emissiveMap ?? whiteTexture },
      uUseEmissiveMap: { value: emissiveMap ? 1 : 0 },
      uOpacity: { value: opacity },
      uAlphaTest: { value: opts.alphaTest ?? 0 },
      ...(opts.vat
        ? {
            uVatPos: { value: opts.vat.position },
            uVatNrm: { value: opts.vat.normal ?? whiteTexture },
            uVatFrames: { value: opts.vat.frames },
            uVatFrame: { value: 0 },
            uVatLerp: { value: 1 },
            uVatHasNrm: { value: opts.vat.normal ? 1 : 0 },
          }
        : {}),
    },
  });
  return mat;
}

/**
 * Build a PS1 material from a glTF-loaded standard/physical material: keep base color,
 * base texture, emissive, and alpha; discard PBR/specular. `KHR_materials_transmission`
 * is approximated as tinted alpha (PRD WS3 — no refraction, decision locked).
 */
export function ps1MaterialFromStandard(
  shared: SharedUniforms,
  source: Material,
  extra: { vertexColors?: boolean; emissiveFromMap?: boolean } = {}
): ShaderMaterial {
  const src = source as Material & {
    color?: Color;
    map?: Texture | null;
    emissive?: Color;
    emissiveIntensity?: number;
    emissiveMap?: Texture | null;
    opacity?: number;
    transmission?: number;
    alphaTest?: number;
  };

  const color = src.color ? src.color.clone().convertLinearToSRGB() : new Color('#cccccc');
  const map = src.map ?? null;
  if (map) setNearest(map);
  const emissiveMap = src.emissiveMap ?? null;
  if (emissiveMap) setNearest(emissiveMap);

  let emissive =
    src.emissive && (src.emissive.r > 0 || src.emissive.g > 0 || src.emissive.b > 0)
      ? src.emissive.clone().convertLinearToSRGB()
      : new Color('#000000');
  let emissiveMapOut = emissiveMap;
  let emissiveIntensity = src.emissiveIntensity ?? 1;

  // Self-illuminate straight from the base texture. Used for "display panel" surfaces (the
  // font/texture-test planes) that sit in an unlit corner our single point light never reaches,
  // so they'd otherwise render near-black. Still goes through posterize/dither/low-res.
  if (extra.emissiveFromMap && map) {
    emissive = new Color('#ffffff');
    emissiveMapOut = map;
    emissiveIntensity = 1;
  }

  // alpha: glTF BLEND → transparent + opacity; transmission → tinted alpha; MASK → alphaTest
  let opacity = src.opacity ?? 1;
  const transmission = src.transmission ?? 0;
  if (transmission > 0) opacity = Math.min(opacity, Math.max(0.1, 1 - transmission * 0.85));
  const transparent = source.transparent || opacity < 1;

  return createPS1Material(shared, {
    map,
    color,
    doubleSided: source.side === DoubleSide || source.side === undefined,
    vertexColors: extra.vertexColors ?? false,
    emissive,
    emissiveIntensity,
    emissiveMap: emissiveMapOut,
    opacity,
    transparent,
    alphaTest: src.alphaTest && src.alphaTest > 0 ? src.alphaTest : 0,
  });
}

function setNearest(tex: Texture): void {
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
}
