import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineSegments,
  ShaderMaterial,
} from 'three';
import {
  cellPosition,
  CENTER_COL,
  CENTER_ROW,
  COLS,
  COLOR,
  GRID_HALF_X,
  PHASES,
  ROWS,
} from './constants';
import { useHeroClock } from './clock';
import { lerp, progress, smoothstep } from '../../lib/easing';

const ARC_X0 = -(GRID_HALF_X + 1.5);
const ARC_X1 = GRID_HALF_X + 1.5;

// Unit cube corners (footprint ±0.5, height 0→1).
const c = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
const B00 = c(-0.5, 0, -0.5);
const B10 = c(0.5, 0, -0.5);
const B11 = c(0.5, 0, 0.5);
const B01 = c(-0.5, 0, 0.5);
const T00 = c(-0.5, 1, -0.5);
const T10 = c(0.5, 1, -0.5);
const T11 = c(0.5, 1, 0.5);
const T01 = c(-0.5, 1, 0.5);
const EDGES: Array<[number[], number[]]> = [
  [B00, B10],
  [B10, B11],
  [B11, B01],
  [B01, B00],
  [T00, T10],
  [T10, T11],
  [T11, T01],
  [T01, T00],
  [B00, T00],
  [B10, T10],
  [B11, T11],
  [B01, T01],
];
const VERTS_PER_CELL = EDGES.length * 2;

const vertexShader = /* glsl */ `
  attribute float aCellX;
  attribute float aSeed;
  attribute float aCenter;
  uniform float uArc;
  uniform float uSweep;
  uniform float uCenterFade;
  varying float vOpacity;
  void main() {
    vec3 p = position;
    float delay = aSeed * 0.45;
    float sp = clamp((uSweep - delay) / 0.55, 0.0, 1.0);
    float ease = sp * sp * sp;                 // accelerate upward
    p.y += (1.0 - aCenter) * ease * 17.0;

    float solid = smoothstep(aCellX - 0.6, aCellX + 0.05, uArc);
    float sweepFade = mix(1.0, 1.0 - sp, 1.0 - aCenter);
    float centerOp = mix(1.0, uCenterFade, aCenter);
    vOpacity = solid * sweepFade * centerOp;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uGlobalOpacity;
  varying float vOpacity;
  void main() {
    gl_FragColor = vec4(uColor, vOpacity * uGlobalOpacity);
  }
`;

export function WireGrid() {
  const clock = useHeroClock();

  const { mesh, material } = useMemo(() => {
    const count = COLS * ROWS;
    const positions = new Float32Array(count * VERTS_PER_CELL * 3);
    const cellX = new Float32Array(count * VERTS_PER_CELL);
    const seed = new Float32Array(count * VERTS_PER_CELL);
    const center = new Float32Array(count * VERTS_PER_CELL);

    let v = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const [cx, , cz] = cellPosition(col, row);
        const s = Math.random();
        const isCenter = col === CENTER_COL && row === CENTER_ROW ? 1 : 0;
        for (const [a, b] of EDGES) {
          for (const corner of [a, b]) {
            positions[v * 3] = cx + corner[0];
            positions[v * 3 + 1] = corner[1];
            positions[v * 3 + 2] = cz + corner[2];
            cellX[v] = cx;
            seed[v] = s;
            center[v] = isCenter;
            v++;
          }
        }
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aCellX', new BufferAttribute(cellX, 1));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));
    geometry.setAttribute('aCenter', new BufferAttribute(center, 1));

    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uArc: { value: ARC_X0 },
        uSweep: { value: 0 },
        uCenterFade: { value: 1 },
        uGlobalOpacity: { value: 1 },
        uColor: { value: new Color(COLOR.wire) },
      },
    });

    const mesh = new LineSegments(geometry, material);
    mesh.frustumCulled = false;
    return { mesh, material };
  }, []);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      material.dispose();
    },
    [mesh, material],
  );

  useFrame(() => {
    const t = clock.current.t;
    mesh.visible = t >= PHASES.arc.start - 0.05 && t < PHASES.morph.start + 1.1;
    if (!mesh.visible) return;
    const u = material.uniforms;
    u.uArc.value = lerp(ARC_X0, ARC_X1, progress(t, PHASES.arc.start, PHASES.arc.end));
    u.uSweep.value = progress(t, PHASES.sweep.start, PHASES.sweep.end);
    u.uCenterFade.value = 1 - smoothstep(PHASES.morph.start, PHASES.morph.start + 0.6, t);
  });

  return <primitive object={mesh} />;
}
