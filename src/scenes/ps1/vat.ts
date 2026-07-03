import {
  BufferAttribute,
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
  Vector3,
  type BufferGeometry,
  type Texture,
} from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

/**
 * VAT (Vertex Animation Texture) runtime — the shader-side half of the data contract
 * shared with tools/bake_vat.py (PRD WS6):
 *   - position/normal textures are V×F: column u = (vertexIndex + 0.5) / V, row v = (frame + 0.5) / F
 *   - float data, NearestFilter, no mips; normals stored raw [-1, 1]
 *   - the mesh carries a `vatId` float attribute = (index + 0.5) / V (from Blender: TEXCOORD "vat_id")
 *   - uVatFrame is fractional and wraps (rows sampled floor/floor+1, lerped)
 */

export interface VatData {
  position: DataTexture;
  normal: DataTexture | null;
  frames: number;
  fps: number;
}

function makeVatTexture(data: Float32Array, width: number, height: number): DataTexture {
  const tex = new DataTexture(data, width, height, RGBAFormat, FloatType);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Add the `vatId` attribute the shader uses to find each vertex's texture column. */
export function addVatIdAttribute(geometry: BufferGeometry): void {
  const count = geometry.attributes.position.count;
  const ids = new Float32Array(count);
  for (let i = 0; i < count; i++) ids[i] = (i + 0.5) / count;
  geometry.setAttribute('vatId', new BufferAttribute(ids, 1));
}

/**
 * Bake a VAT at runtime from a deformer function — used by the demo rig, and handy for
 * any procedural looper. `deform` must be periodic in t01 ∈ [0,1) for a seamless loop.
 * Positions and recomputed smooth normals are written per frame, exactly like the
 * Blender bake script does offline.
 */
export function bakeVatFromDeformer(
  geometry: BufferGeometry,
  frames: number,
  fps: number,
  deform: (src: Vector3, t01: number, out: Vector3) => void
): VatData {
  const count = geometry.attributes.position.count;
  const basePos = geometry.attributes.position.array as Float32Array;
  const work = geometry.clone(); // scratch geometry for per-frame normal recompute
  const workPos = work.attributes.position;

  const posData = new Float32Array(count * frames * 4);
  const nrmData = new Float32Array(count * frames * 4);
  const src = new Vector3();
  const out = new Vector3();

  for (let f = 0; f < frames; f++) {
    const t01 = f / frames;
    for (let i = 0; i < count; i++) {
      src.fromArray(basePos, i * 3);
      deform(src, t01, out);
      workPos.setXYZ(i, out.x, out.y, out.z);
    }
    workPos.needsUpdate = true;
    work.computeVertexNormals();
    const nrm = work.attributes.normal;
    const row = f * count;
    for (let i = 0; i < count; i++) {
      const b = (row + i) * 4;
      posData[b] = workPos.getX(i);
      posData[b + 1] = workPos.getY(i);
      posData[b + 2] = workPos.getZ(i);
      posData[b + 3] = 1;
      nrmData[b] = nrm.getX(i);
      nrmData[b + 1] = nrm.getY(i);
      nrmData[b + 2] = nrm.getZ(i);
      nrmData[b + 3] = 1;
    }
  }
  work.dispose();

  return {
    position: makeVatTexture(posData, count, frames),
    normal: makeVatTexture(nrmData, count, frames),
    frames,
    fps,
  };
}

/** Sidecar metadata written by tools/bake_vat.py (`<name>.vat.json`). */
export interface VatMeta {
  vertexCount: number;
  frameCount: number;
  fps: number;
  encoding: 'EXR' | 'PNG16';
  positionTexture: string;
  normalTexture: string | null;
}

/**
 * Load a Blender-baked VAT (EXR encoding) given its sidecar metadata. The GLB's
 * `vat_id` UV (TEXCOORD_1 → three attribute `uv1`) should be copied into `vatId`
 * via {@link vatIdFromUv1} after loading the mesh.
 */
export async function loadVatFromBake(baseUrl: string, meta: VatMeta): Promise<VatData> {
  if (meta.encoding !== 'EXR') {
    throw new Error('[vat] PNG16 decode not wired yet — bake with ENCODING="EXR"');
  }
  const loader = new EXRLoader().setDataType(FloatType);
  const configure = (tex: Texture) => {
    tex.minFilter = NearestFilter;
    tex.magFilter = NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  };
  const position = configure(await loader.loadAsync(baseUrl + meta.positionTexture));
  const normal = meta.normalTexture
    ? configure(await loader.loadAsync(baseUrl + meta.normalTexture))
    : null;
  return {
    position: position as unknown as DataTexture,
    normal: normal as unknown as DataTexture | null,
    frames: meta.frameCount,
    fps: meta.fps,
  };
}

/** Copy a Blender-exported `vat_id` UV channel (three: `uv1`) into the `vatId` attribute. */
export function vatIdFromUv1(geometry: BufferGeometry): void {
  const uv1 = geometry.attributes.uv1;
  if (!uv1) throw new Error('[vat] geometry has no uv1 (vat_id) channel');
  const count = uv1.count;
  const ids = new Float32Array(count);
  for (let i = 0; i < count; i++) ids[i] = uv1.getX(i);
  geometry.setAttribute('vatId', new BufferAttribute(ids, 1));
}
