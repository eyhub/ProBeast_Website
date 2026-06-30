import { GLSL3, ShaderMaterial, Vector2 } from 'three';

/** Fullscreen upscale + posterize + ordered (Bayer) dither. */
export function createPostMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uScene: { value: null },
      uResolution: { value: new Vector2(320, 240) },
      uLevels: { value: 32 },
      uDither: { value: 1 },
    },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0); // fullscreen, camera-independent
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uScene;
      uniform vec2 uResolution;
      uniform float uLevels;
      uniform float uDither;
      in vec2 vUv;
      out vec4 fragColor;

      float bayer4x4(vec2 p) {
        int x = int(mod(p.x, 4.0));
        int y = int(mod(p.y, 4.0));
        int idx = y * 4 + x;
        float m[16] = float[16](
          0.0,  8.0,  2.0,  10.0,
          12.0, 4.0,  14.0, 6.0,
          3.0,  11.0, 1.0,  9.0,
          15.0, 7.0,  13.0, 5.0
        );
        return (m[idx] + 0.5) / 16.0 - 0.5;
      }

      void main() {
        vec3 c = texture(uScene, vUv).rgb;
        vec2 lowResPixel = floor(vUv * uResolution); // chunky dither on the low-res grid
        float t = bayer4x4(lowResPixel) * uDither;
        c += t / uLevels;
        c = floor(c * uLevels + 0.5) / uLevels;
        fragColor = vec4(c, 1.0);
      }
    `,
  });
}
