import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AnimationClip,
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  NearestFilter,
  NumberKeyframeTrack,
  Quaternion,
  QuaternionKeyframeTrack,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type ShaderMaterial,
} from 'three';
import { createPS1Material, type SharedUniforms } from './ps1Material';
import { addVatIdAttribute, bakeVatFromDeformer, type VatData } from './vat';
import { useSceneAnimations } from './useSceneAnimations';
import { makeCubeTexture } from './textures';

/**
 * Verification rig for the PRD extensions (docs/prd/ps1-material-animation-extensions.md).
 * Six stations, left → right as seen from the Demo camera:
 *   1 vertex colors · 2 emissive factor · 3 emissive map screen ·
 *   4 tinted-alpha glass (+ crate behind) · 5 TRS clip via AnimationMixer · 6 VAT tentacle
 * Floats in the void behind the Outside camera; reachable via the "Demo" nav entry.
 */

interface DemoClusterProps {
  shared: SharedUniforms;
  position: Vector3;
  quaternion: Quaternion;
  vatLerp: boolean;
  animPlaying: boolean;
  animSpeed: number;
}

const STATION_X = [-2.05, -1.23, -0.41, 0.41, 1.23, 2.05];
const PEDESTAL_Y = -0.95;

interface Rig {
  group: Group;
  clips: AnimationClip[];
  vatMaterial: ShaderMaterial;
  vat: VatData;
  dispose: () => void;
}

/** Tiny CRT-ish test card for the emissive-map station. */
function makeScreenTexture(): CanvasTexture {
  const w = 64;
  const h = 48;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const x = cv.getContext('2d');
  if (x) {
    x.fillStyle = '#04070a';
    x.fillRect(0, 0, w, h);
    // scanlines
    x.fillStyle = '#062821';
    for (let y = 0; y < h; y += 4) x.fillRect(0, y, w, 1);
    // petrol block bars (a fake "signal")
    x.fillStyle = '#19e9d2';
    x.fillRect(6, 8, 20, 10);
    x.fillRect(30, 8, 8, 10);
    x.fillStyle = '#00a99d';
    x.fillRect(6, 24, 34, 4);
    x.fillRect(6, 32, 22, 4);
    // hot white pixel cluster
    x.fillStyle = '#ffffff';
    x.fillRect(48, 10, 6, 6);
  }
  const tex = new CanvasTexture(cv);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Rainbow COLOR_0 gradient over an icosahedron (linear values — shader converts to sRGB). */
function makeVertexColorGeometry(): BufferGeometry {
  const geo = new IcosahedronGeometry(0.42, 1);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const hue = (pos.getY(i) / 0.84 + 0.5) * 0.8 + pos.getX(i) * 0.1;
    c.setHSL(((hue % 1) + 1) % 1, 0.85, 0.6, SRGBColorSpace);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

function buildRig(worldShared: SharedUniforms): Rig {
  // Demo-local lighting overlay: the rig floats in the void far from the garage's point
  // light, so give ITS materials brighter ambient + directional fill (local IUniform
  // objects). Snap/affine/fog/point-light refs stay shared — the garage look is untouched.
  const shared: SharedUniforms = {
    ...worldShared,
    uAmbient: { value: new Color('#5e6a72') },
    uLightColor: { value: new Color('#9aa6ad') },
  };

  const group = new Group();
  group.name = 'DemoRig';
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(d: T): T => {
    disposables.push(d);
    return d;
  };

  const addMesh = (geo: BufferGeometry, mat: ShaderMaterial, x: number, y: number, z = 0, name = '') => {
    const mesh = new Mesh(track(geo), track(mat));
    mesh.position.set(x, y, z);
    if (name) mesh.name = name;
    group.add(mesh);
    return mesh;
  };

  // pedestals — one per station, plain dark slabs (also show baseline lighting)
  const pedestalMat = track(createPS1Material(shared, { color: new Color('#242b31') }));
  for (const x of STATION_X) {
    const p = new Mesh(track(new BoxGeometry(0.8, 0.08, 0.8)), pedestalMat);
    p.position.set(x, PEDESTAL_Y, 0);
    group.add(p);
  }

  // 1 — vertex colors (WS1)
  addMesh(
    makeVertexColorGeometry(),
    createPS1Material(shared, { color: new Color('#ffffff'), vertexColors: true }),
    STATION_X[0],
    -0.35
  );

  // 2 — emissive factor (WS2): dark slab that glows petrol on its own
  addMesh(
    new BoxGeometry(0.5, 0.8, 0.14),
    createPS1Material(shared, {
      color: new Color('#10151a'),
      emissive: new Color('#19e9d2'),
      emissiveIntensity: 1.4,
    }),
    STATION_X[1],
    -0.4
  );

  // 3 — emissive map (WS2): unlit CRT test card
  addMesh(
    new BoxGeometry(0.92, 0.7, 0.1),
    createPS1Material(shared, {
      color: new Color('#0a0d10'),
      emissive: new Color('#ffffff'),
      emissiveIntensity: 1.2,
      emissiveMap: track(makeScreenTexture()),
    }),
    STATION_X[2],
    -0.42
  );

  // 4 — tinted-alpha glass (WS3): crate straddles the pane's edge, half tinted half clear
  addMesh(
    new BoxGeometry(0.4, 0.4, 0.4),
    createPS1Material(shared, { map: track(makeCubeTexture()) }),
    STATION_X[3] + 0.3,
    -0.5,
    -0.4
  );
  addMesh(
    new BoxGeometry(0.85, 0.95, 0.05),
    createPS1Material(shared, { color: new Color('#7fe8de'), opacity: 0.42 }),
    STATION_X[3],
    -0.35
  );

  // 5 — TRS clip through the AnimationMixer (WS4): spinning hub + bobbing arm
  const hub = addMesh(
    new BoxGeometry(0.22, 0.55, 0.22),
    createPS1Material(shared, { color: new Color('#c8551e') }),
    STATION_X[4],
    -0.5,
    0,
    'DemoSpinnerBase'
  );
  const arm = new Mesh(
    track(new BoxGeometry(0.6, 0.1, 0.1)),
    track(createPS1Material(shared, { color: new Color('#e8b13c') }))
  );
  arm.name = 'DemoSpinnerArm';
  arm.position.set(0.38, 0.12, 0);
  hub.add(arm);

  const yq = (a: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a);
  const spin = new QuaternionKeyframeTrack(
    'DemoSpinnerBase.quaternion',
    [0, 1, 2, 3, 4],
    [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, Math.PI * 2].flatMap((a) => yq(a).toArray())
  );
  const bob = new NumberKeyframeTrack('DemoSpinnerArm.position[y]', [0, 2, 4], [0.12, 0.42, 0.12]);
  const clips = [new AnimationClip('demo-spin', 4, [spin, bob])];

  // 6 — VAT tentacle (WS6): runtime-baked waving cylinder, same contract as bake_vat.py
  const tentacleGeo = track(new CylinderGeometry(0.13, 0.24, 1.3, 10, 16));
  addVatIdAttribute(tentacleGeo);
  const vat = bakeVatFromDeformer(tentacleGeo, 48, 24, (src, t01, out) => {
    const h01 = (src.y + 0.65) / 1.3; // 0 at base, 1 at tip
    const phase = t01 * Math.PI * 2;
    out.set(
      src.x + Math.sin(h01 * 2.6 + phase) * 0.3 * h01 * h01,
      src.y,
      src.z + Math.cos(h01 * 1.9 + phase * 2) * 0.14 * h01 * h01
    );
  });
  track(vat.position);
  if (vat.normal) track(vat.normal);
  const vatMaterial = createPS1Material(shared, {
    color: new Color('#d8cfc0'),
    vat: { position: vat.position, normal: vat.normal, frames: vat.frames },
  });
  addMesh(tentacleGeo, vatMaterial, STATION_X[5], -0.26);

  return {
    group,
    clips,
    vatMaterial,
    vat,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

export function DemoCluster({
  shared,
  position,
  quaternion,
  vatLerp,
  animPlaying,
  animSpeed,
}: DemoClusterProps) {
  const rig = useMemo(() => buildRig(shared), [shared]);
  useEffect(() => () => rig.dispose(), [rig]);

  useSceneAnimations(rig.group, rig.clips, { playing: animPlaying, speed: animSpeed });

  useFrame((state) => {
    const u = rig.vatMaterial.uniforms;
    u.uVatFrame.value = (state.clock.elapsedTime * rig.vat.fps) % rig.vat.frames;
    u.uVatLerp.value = vatLerp ? 1 : 0;
  }, 0);

  return <primitive object={rig.group} position={position} quaternion={quaternion} />;
}
