import { CanvasTexture, LinearFilter, NearestFilter, RepeatWrapping, SRGBColorSpace } from 'three';

function nearest(tex: CanvasTexture): CanvasTexture {
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Tiling grid floor — affine warp + snapping read clearly on this. */
export function makeGroundTexture(): CanvasTexture {
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const x = cv.getContext('2d');
  if (x) {
    x.fillStyle = '#141d23';
    x.fillRect(0, 0, s, s);
    x.strokeStyle = '#27525d';
    x.lineWidth = 2;
    for (let i = 0; i <= s; i += 32) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i, s);
      x.stroke();
      x.beginPath();
      x.moveTo(0, i);
      x.lineTo(s, i);
      x.stroke();
    }
    x.strokeStyle = '#00d2c0';
    x.lineWidth = 6;
    x.strokeRect(0, 0, s, s);
  }
  const t = nearest(new CanvasTexture(cv));
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(24, 24);
  return t;
}

/** A chunky crate-ish face so affine warping shows on the cube too. */
export function makeCubeTexture(): CanvasTexture {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const x = cv.getContext('2d');
  if (x) {
    x.fillStyle = '#0c615a';
    x.fillRect(0, 0, s, s);
    x.fillStyle = '#11a394';
    x.fillRect(6, 6, s - 12, s - 12);
    x.fillStyle = '#0a4f49';
    x.fillRect(14, 14, s - 28, s - 28);
    x.fillStyle = '#19e9d2';
    x.fillRect(18, 18, 10, 10);
    x.strokeStyle = '#053b36';
    x.lineWidth = 4;
    x.strokeRect(2, 2, s - 4, s - 4);
  }
  return nearest(new CanvasTexture(cv));
}

export function setTextureFilter(tex: CanvasTexture, useNearest: boolean): void {
  const f = useNearest ? NearestFilter : LinearFilter;
  tex.minFilter = f;
  tex.magFilter = f;
  tex.needsUpdate = true;
}
