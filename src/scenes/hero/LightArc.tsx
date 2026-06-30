import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, DoubleSide, type Mesh, type MeshBasicMaterial } from 'three';
import { CELL, COLOR, GRID_HALF_X, PHASES, ROWS } from './constants';
import { useHeroClock } from './clock';
import { clamp01, lerp, progress } from '../../lib/easing';

const ARC_X0 = -(GRID_HALF_X + 1.5);
const ARC_X1 = GRID_HALF_X + 1.5;

/** A bright vertical light sheet that sweeps across, solidifying the grid. */
export function LightArc() {
  const clock = useHeroClock();
  const mesh = useRef<Mesh>(null);
  const mat = useRef<MeshBasicMaterial>(null);

  useFrame(() => {
    const t = clock.current.t;
    const active = t >= PHASES.arc.start - 0.1 && t <= PHASES.arc.end + 0.15;
    if (mesh.current) {
      mesh.current.visible = active;
      mesh.current.position.x = lerp(ARC_X0, ARC_X1, progress(t, PHASES.arc.start, PHASES.arc.end));
    }
    if (mat.current) {
      mat.current.opacity = Math.sin(Math.PI * clamp01(progress(t, PHASES.arc.start, PHASES.arc.end))) * 0.85;
    }
  });

  return (
    <mesh ref={mesh} rotation={[0, Math.PI / 2, 0]} position={[ARC_X0, 0.7, 0]} visible={false}>
      <planeGeometry args={[ROWS * CELL + 3, 3.2]} />
      <meshBasicMaterial
        ref={mat}
        color={COLOR.white}
        transparent
        opacity={0}
        blending={AdditiveBlending}
        depthWrite={false}
        side={DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
}
