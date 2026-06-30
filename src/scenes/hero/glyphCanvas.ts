/* Canvas2D → CanvasTexture glyph rendering + an instanced glyph material.
   Uses the browser's font engine (loads the repaired Eurostile reliably,
   unlike troika/drei <Text>). */

import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';

export const DISPLAY_FONT = "'Eurostile Extended', system-ui, sans-serif";
export const MONO_FONT = "ui-monospace, 'Cascadia Code', 'JetBrains Mono', Consolas, monospace";

/** A single white letter on transparent — tint via the material's color. */
export function makeLetterTexture(char: string, px = 256): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, px, px);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(px * 0.72)}px ${DISPLAY_FONT}`;
    ctx.fillText(char, px / 2, px / 2 + px * 0.04);
  }
  return finishTexture(new CanvasTexture(canvas));
}

export interface GlyphAtlas {
  texture: CanvasTexture;
  cols: number;
  rows: number;
  count: number;
}

/** Packs `chars` into a square-ish grid of white glyphs on transparent. */
export function makeGlyphAtlas(chars: string, cell = 64): GlyphAtlas {
  const count = chars.length;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(cell * 0.66)}px ${MONO_FONT}`;
    for (let i = 0; i < count; i++) {
      const cx = (i % cols) * cell + cell / 2;
      const cy = Math.floor(i / cols) * cell + cell / 2;
      ctx.fillText(chars[i], cx, cy);
    }
  }
  return { texture: finishTexture(new CanvasTexture(canvas)), cols, rows, count };
}

function finishTexture(tex: CanvasTexture): CanvasTexture {
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Instanced glyph material. Reads per-instance attributes:
 *  - aGlyph   (glyph index → atlas UV cell)
 *  - aOpacity (0..1 alpha)
 *  - aBright  (rgb multiplier; heads glow brighter)
 * Additive blending over black gives the matrix glow.
 */
export function createGlyphMaterial(atlas: GlyphAtlas, color: string): MeshBasicMaterial {
  const mat = new MeshBasicMaterial({
    map: atlas.texture,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
  mat.color = new Color(color);

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCols = { value: atlas.cols };
    shader.uniforms.uRows = { value: atlas.rows };
    shader.vertexShader =
      'attribute float aGlyph;\nattribute float aOpacity;\nattribute float aBright;\n' +
      'varying float vOpacity;\nvarying float vBright;\nuniform float uCols;\nuniform float uRows;\n' +
      shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        #ifdef USE_MAP
          float g = aGlyph;
          float gc = mod(g, uCols);
          float gr = floor(g / uCols);
          vMapUv = (vMapUv + vec2(gc, uRows - 1.0 - gr)) / vec2(uCols, uRows);
        #endif
        vOpacity = aOpacity;
        vBright = aBright;`,
      );
    shader.fragmentShader =
      'varying float vOpacity;\nvarying float vBright;\n' +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        diffuseColor.a *= vOpacity;
        diffuseColor.rgb *= vBright;`,
      );
  };
  mat.customProgramCacheKey = () => 'probeast-glyph';
  return mat;
}

/** Quaternion that orients a +Z-facing quad toward a fixed camera direction. */
export function billboardQuaternion(viewDir: Vector3): Quaternion {
  const forward = viewDir.clone().normalize();
  const up = new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(up, forward).normalize();
  const up2 = new Vector3().crossVectors(forward, right).normalize();
  const m = new Matrix4().makeBasis(right, up2, forward);
  return new Quaternion().setFromRotationMatrix(m);
}
