import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Object3D,
  PlaneGeometry,
} from 'three';
import { COLOR, ISO_DIR } from './constants';
import { useHeroClock } from './clock';
import { billboardQuaternion, createGlyphMaterial, type GlyphAtlas } from './glyphCanvas';
import { PHASES } from './constants';
import { smoothstep } from '../../lib/easing';

const COLUMNS = 64;
const STREAM = 16;
const COUNT = COLUMNS * STREAM;
const TOP = 9;
const BOTTOM = -1.5;
const DY = 0.62;
const CYCLE = TOP - BOTTOM + STREAM * DY;
const SPREAD = 8.5;

export function RainField({ atlas }: { atlas: GlyphAtlas }) {
  const clock = useHeroClock();

  const { mesh, aOpacity, aBright, columns } = useMemo(() => {
    const geometry = new PlaneGeometry(0.6, 0.78);
    const glyph = new Float32Array(COUNT);
    const opacity = new Float32Array(COUNT);
    const bright = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      glyph[i] = Math.floor(Math.random() * atlas.count);
      bright[i] = 1;
    }
    geometry.setAttribute('aGlyph', new InstancedBufferAttribute(glyph, 1));
    const aOpacity = new InstancedBufferAttribute(opacity, 1);
    const aBright = new InstancedBufferAttribute(bright, 1);
    geometry.setAttribute('aOpacity', aOpacity);
    geometry.setAttribute('aBright', aBright);

    const material = createGlyphMaterial(atlas, COLOR.glyph);
    const mesh = new InstancedMesh(geometry, material, COUNT);
    mesh.frustumCulled = false;

    const quat = billboardQuaternion(ISO_DIR);
    const columns = Array.from({ length: COLUMNS }, () => ({
      x: (Math.random() * 2 - 1) * SPREAD,
      z: (Math.random() * 2 - 1) * SPREAD,
      speed: 2 + Math.random() * 3,
      offset: Math.random() * CYCLE,
      quat,
    }));
    return { mesh, aOpacity, aBright, columns };
  }, [atlas]);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      (mesh.material as { dispose(): void }).dispose();
    };
  }, [mesh]);

  const dummy = useMemo(() => new Object3D(), []);
  const mat4 = useMemo(() => new Matrix4(), []);

  useFrame(() => {
    const t = clock.current.t;
    const global = 1 - smoothstep(PHASES.arc.start, PHASES.arc.end, t);
    mesh.visible = global > 0.001;
    if (!mesh.visible) return;

    const op = aOpacity.array as Float32Array;
    const br = aBright.array as Float32Array;

    for (let c = 0; c < COLUMNS; c++) {
      const col = columns[c];
      const head = TOP - ((t * col.speed + col.offset) % CYCLE);
      dummy.quaternion.copy(col.quat);
      dummy.scale.setScalar(1);
      for (let k = 0; k < STREAM; k++) {
        const i = c * STREAM + k;
        const y = head - k * DY;
        dummy.position.set(col.x, y, col.z);
        dummy.updateMatrix();
        mat4.copy(dummy.matrix);
        mesh.setMatrixAt(i, mat4);

        const tailFade = Math.max(0.12, 1.9 * Math.pow(0.86, k));
        const edge = y < BOTTOM ? 0 : y > TOP ? 0 : 1;
        br[i] = tailFade;
        op[i] = global * edge;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    aOpacity.needsUpdate = true;
    aBright.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
