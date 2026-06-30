import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  InstancedBufferAttribute,
  InstancedMesh,
  Object3D,
  PlaneGeometry,
} from 'three';
import {
  cellPosition,
  COLS,
  COLOR,
  GRID_HALF_X,
  ISO_DIR,
  PHASES,
  ROWS,
} from './constants';
import { useHeroClock } from './clock';
import { billboardQuaternion, createGlyphMaterial, type GlyphAtlas } from './glyphCanvas';
import { easeOutCubic, lerp, progress, smoothstep } from '../../lib/easing';

const COUNT = COLS * ROWS;
const ARC_X0 = -(GRID_HALF_X + 1.5);
const ARC_X1 = GRID_HALF_X + 1.5;

export function CellGlyphs({ atlas }: { atlas: GlyphAtlas }) {
  const clock = useHeroClock();

  const { mesh, aOpacity, aBright, cells } = useMemo(() => {
    const geometry = new PlaneGeometry(0.62, 0.62);
    const glyph = new Float32Array(COUNT);
    const opacity = new Float32Array(COUNT);
    const bright = new Float32Array(COUNT);

    const cells = [];
    let i = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++, i++) {
        const [x, , z] = cellPosition(col, row);
        const revealStart =
          PHASES.rain.start + Math.random() * (PHASES.rain.end - 0.4 - PHASES.rain.start);
        cells.push({ x, z, revealStart });
        glyph[i] = Math.floor(Math.random() * atlas.count);
        bright[i] = 1;
      }
    }
    geometry.setAttribute('aGlyph', new InstancedBufferAttribute(glyph, 1));
    const aOpacity = new InstancedBufferAttribute(opacity, 1);
    const aBright = new InstancedBufferAttribute(bright, 1);
    geometry.setAttribute('aOpacity', aOpacity);
    geometry.setAttribute('aBright', aBright);

    const mesh = new InstancedMesh(geometry, createGlyphMaterial(atlas, COLOR.glyph), COUNT);
    mesh.frustumCulled = false;
    return { mesh, aOpacity, aBright, cells };
  }, [atlas]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as { dispose(): void }).dispose();
    },
    [mesh],
  );

  const dummy = useMemo(() => new Object3D(), []);
  const quat = useMemo(() => billboardQuaternion(ISO_DIR), []);

  useFrame(() => {
    const t = clock.current.t;
    mesh.visible = t <= PHASES.arc.end + 0.15;
    if (!mesh.visible) return;

    const arcX = lerp(ARC_X0, ARC_X1, progress(t, PHASES.arc.start, PHASES.arc.end));
    const op = aOpacity.array as Float32Array;
    const br = aBright.array as Float32Array;

    for (let i = 0; i < COUNT; i++) {
      const cell = cells[i];
      const reveal = easeOutCubic(progress(t, cell.revealStart, cell.revealStart + 0.4));
      const cellFade = 1 - smoothstep(cell.x - 0.2, cell.x + 0.5, arcX);

      dummy.position.set(cell.x, 0.5, cell.z);
      dummy.quaternion.copy(quat);
      dummy.scale.setScalar(lerp(0.7, 1, reveal));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const pop = 0.9 * Math.exp(-(((t - cell.revealStart) / 0.16) ** 2));
      br[i] = 1.05 + pop;
      op[i] = reveal * cellFade;
    }
    mesh.instanceMatrix.needsUpdate = true;
    aOpacity.needsUpdate = true;
    aBright.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
