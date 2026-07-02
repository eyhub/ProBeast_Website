import { GLSL3, ShaderMaterial } from 'three';

/**
 * Fullscreen rainbow gradient: hue sweeps across a slowly-rotating axis and
 * drifts over time ("rotating colors"), with subtle animated grain. Drawn
 * camera-independent (position.xy → clip space) and behind everything.
 */
export function createBackgroundMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uSaturation: { value: 0.62 },
      uValue: { value: 0.5 },
      uNoise: { value: 0.05 },
    },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 1.0, 1.0); // fullscreen, behind scene
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSaturation;
      uniform float uValue;
      uniform float uNoise;
      in vec2 vUv;
      out vec4 fragColor;

      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        vec2 p = vUv - 0.5;
        float ang = uTime * 0.12;                 // gradient axis slowly rotates
        vec2 dir = vec2(cos(ang), sin(ang));
        float g = dot(p, dir) + 0.5;
        float hue = fract(g * 1.1 + uTime * 0.06); // rainbow along axis + drift
        vec3 col = hsv2rgb(vec3(hue, uSaturation, uValue));

        // slight grain (gentle temporal shimmer)
        float n = hash(floor(vUv * 320.0) + floor(uTime * 12.0));
        col += (n - 0.5) * uNoise;

        fragColor = vec4(col, 1.0);
      }
    `,
  });
}
