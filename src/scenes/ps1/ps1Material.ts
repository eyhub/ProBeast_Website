import {
  Color,
  GLSL3,
  ShaderMaterial,
  Vector2,
  Vector3,
  type IUniform,
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
  uFogColor: IUniform<Color>;
  uFogNear: IUniform<number>;
  uFogFar: IUniform<number>;
}

export function makeSharedUniforms(): SharedUniforms {
  return {
    uSnapRes: { value: new Vector2(320, 240) },
    uSnapAmt: { value: 1 },
    uAffineAmt: { value: 1 },
    uLightDir: { value: new Vector3(5, 8, 4).normalize() },
    uLightColor: { value: new Color('#ffffff') },
    uAmbient: { value: new Color('#5a6b74') },
    uFogColor: { value: new Color('#06080a') },
    uFogNear: { value: 4 },
    uFogFar: { value: 38 },
  };
}

const vertexShader = /* glsl */ `
  uniform vec2 uSnapRes;
  uniform float uSnapAmt;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform vec3 uAmbient;

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

    // (5) per-vertex Lambert
    vec3 n = normalize(normalMatrix * normal);
    float diff = max(dot(n, normalize(uLightDir)), 0.0);
    vColor = uAmbient + uLightColor * diff;

    // (8) linear fog by view depth (1 near, 0 far)
    float dist = -mv.z;
    vFog = clamp((uFogFar - dist) / (uFogFar - uFogNear), 0.0, 1.0);

    gl_Position = clip;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
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
    vec3 tex = texture(uMap, uv).rgb;
    vec3 col = tex * vColor;
    col = mix(uFogColor, col, vFog);
    fragColor = vec4(col, 1.0);
  }
`;

export function createPS1Material(shared: SharedUniforms, map: Texture): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: {
      ...shared,
      uMap: { value: map },
    },
  });
}
