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
  uFogColor: IUniform<Color>;
  uFogNear: IUniform<number>;
  uFogFar: IUniform<number>;
}

export function makeSharedUniforms(): SharedUniforms {
  return {
    uSnapRes: { value: new Vector2(320, 240) },
    uSnapAmt: { value: 1 },
    uAffineAmt: { value: 1 },
    // Directional term is now a dim fill; the point light does the real work.
    uLightDir: { value: new Vector3(5, 8, 4).normalize() },
    uLightColor: { value: new Color('#333d45') },
    uAmbient: { value: new Color('#434e57') },
    uPointPosView: { value: new Vector3(0, 0, 0) },
    uPointColor: { value: new Color('#ffffff') },
    uPointIntensity: { value: 25 },
    uFogColor: { value: new Color('#06080a') },
    uFogNear: { value: 4 },
    uFogFar: { value: 38 },
  };
}

/** 1×1 white fallback so `texture(uMap, uv)` is always valid, even on flat-color materials. */
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

  out vec2 vUvP;   // perspective-correct uv
  out vec2 vUvA;   // uv * w  (affine numerator)
  out float vW;
  out vec3 vColor; // per-vertex (Gouraud) light
  out float vFog;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
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

    // (5) per-vertex Gouraud lighting, computed in VIEW space
    vec3 n = normalize(normalMatrix * normal);
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
  uniform float uUseMap;   // 1 = sample uMap, 0 = use flat uColor
  uniform vec3 uColor;     // flat base color (sRGB display values)
  uniform float uAffineAmt;
  uniform vec3 uFogColor;

  in vec2 vUvP;
  in vec2 vUvA;
  in float vW;
  in vec3 vColor;
  in float vFog;

  out vec4 fragColor;

  void main() {
    vec2 uvAffine = vUvA / vW;
    vec2 uv = mix(vUvP, uvAffine, uAffineAmt);
    vec3 base = mix(uColor, texture(uMap, uv).rgb, uUseMap);
    vec3 col = base * vColor;
    col = mix(uFogColor, col, vFog);
    fragColor = vec4(col, 1.0);
  }
`;

export interface PS1MaterialOptions {
  map?: Texture | null;
  color?: Color;
  doubleSided?: boolean;
}

export function createPS1Material(
  shared: SharedUniforms,
  opts: PS1MaterialOptions = {}
): ShaderMaterial {
  const map = opts.map ?? null;
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader,
    side: opts.doubleSided ? DoubleSide : undefined,
    uniforms: {
      ...shared,
      uMap: { value: map ?? whiteTexture },
      uUseMap: { value: map ? 1 : 0 },
      uColor: { value: opts.color ?? new Color('#ffffff') },
    },
  });
}

/**
 * Build a PS1 material from a glTF-loaded standard/physical material: keep its base color and
 * (optional) texture, discard PBR/specular. glTF baseColorFactor is linear → convert to sRGB
 * display values so the flat colors don't render near-black.
 */
export function ps1MaterialFromStandard(shared: SharedUniforms, source: Material): ShaderMaterial {
  const src = source as Material & { color?: Color; map?: Texture | null };
  const color = src.color ? src.color.clone().convertLinearToSRGB() : new Color('#cccccc');
  const map = src.map ?? null;
  if (map) {
    map.minFilter = NearestFilter;
    map.magFilter = NearestFilter;
    map.generateMipmaps = false;
    map.anisotropy = 1;
    map.needsUpdate = true;
  }
  return createPS1Material(shared, {
    map,
    color,
    doubleSided: source.side === DoubleSide || source.side === undefined,
  });
}
