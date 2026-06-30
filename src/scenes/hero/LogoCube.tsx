import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Edges, RoundedBox } from '@react-three/drei';
import type { CanvasTexture, Group, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { COLOR, HOPS, PHASES } from './constants';
import { makeLetterTexture } from './glyphCanvas';
import { useHeroClock } from './clock';
import { useFontReady } from '../../lib/useFontReady';
import { clamp01, easeOutBack, jumpArc, progress, smoothstep } from '../../lib/easing';

const HALF = 0.5;
const EPS = 0.014;
const HOP_HEIGHT = 1.45;

type FaceId = 'P' | 'B' | 'S';

interface FaceConfig {
  id: FaceId;
  char: string;
  position: [number, number, number];
  rotation: [number, number, number];
}

/* Hop order follows array order: P (top) → B (left) → S (right). */
const FACES: FaceConfig[] = [
  { id: 'P', char: 'P', position: [0, HALF, 0], rotation: [-Math.PI / 2, 0, 0] },
  { id: 'B', char: 'B', position: [0, 0, HALF], rotation: [0, 0, 0] },
  { id: 'S', char: 'S', position: [HALF, 0, 0], rotation: [0, Math.PI / 2, 0] },
];

export function LogoCube() {
  const clock = useHeroClock();
  const group = useRef<Group>(null);
  const panelMats = useRef<(MeshStandardMaterial | null)[]>([null, null, null]);
  const letterMats = useRef<(MeshBasicMaterial | null)[]>([null, null, null]);

  const fontReady = useFontReady("900 64px 'Eurostile Extended'");
  const textures = useMemo<Record<FaceId, CanvasTexture> | null>(() => {
    if (!fontReady) return null;
    return { P: makeLetterTexture('P'), B: makeLetterTexture('B'), S: makeLetterTexture('S') };
  }, [fontReady]);

  useEffect(
    () => () => {
      if (textures) Object.values(textures).forEach((t) => t.dispose());
    },
    [textures],
  );

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const T = clock.current.t;

    if (T < PHASES.morph.start) {
      g.visible = false;
      return;
    }
    g.visible = true;

    // Morph-in: scale up with a touch of overshoot.
    const sIn = easeOutBack(progress(T, PHASES.morph.start, PHASES.morph.end));

    let y = 0.5;
    let sx = 1;
    let sy = 1;
    let sz = 1;
    g.rotation.y = 0;

    if (T >= PHASES.jump.start && T <= PHASES.jump.end) {
      const hopDur = (PHASES.jump.end - PHASES.jump.start) / HOPS;
      const local = T - PHASES.jump.start;
      const h = Math.min(HOPS - 1, Math.floor(local / hopDur));
      const p = clamp01((local - h * hopDur) / hopDur);
      const contact = Math.exp(-(((p - 1) / 0.12) ** 2)) + Math.exp(-((p / 0.12) ** 2));
      y = 0.5 + jumpArc(p) * HOP_HEIGHT;
      sy = 1 + 0.16 * Math.sin(Math.PI * p) - 0.24 * contact;
      const xz = 1 - 0.1 * Math.sin(Math.PI * p) + 0.2 * contact;
      sx = xz;
      sz = xz;
      y -= (1 - sy) * 0.5; // keep the base planted while squashing
    } else if (T > PHASES.jump.end) {
      // Settle: gentle idle float (continuous, survives timeline clamp).
      const a = state.clock.elapsedTime;
      y = 0.5 + Math.sin(a * 1.2) * 0.05;
      g.rotation.y = Math.sin(a * 0.4) * 0.03;
    }

    g.position.y = y;
    g.scale.set(sx * sIn, sy * sIn, sz * sIn);

    // Sequential face lighting: each hop lights the next face petrol-green.
    for (let i = 0; i < 3; i++) {
      let lit = 0.12;
      if (T >= PHASES.jump.start) {
        const hopDur = (PHASES.jump.end - PHASES.jump.start) / HOPS;
        const hs = PHASES.jump.start + i * hopDur;
        const apex = hs + hopDur * 0.5;
        const sustained = smoothstep(hs, hs + 0.15, T) * 0.42;
        const flash = 0.95 * Math.exp(-(((T - apex) / 0.18) ** 2));
        lit = 0.12 + sustained + flash;
      }
      const pm = panelMats.current[i];
      if (pm) pm.emissiveIntensity = 0.18 + lit * 2.4;
      const lm = letterMats.current[i];
      if (lm) lm.color.set(lit > 0.5 ? COLOR.white : COLOR.petrolBright);
    }
  });

  return (
    <group ref={group} position={[0, 0.5, 0]} visible={false}>
      <RoundedBox args={[1, 1, 1]} radius={0.07} smoothness={4}>
        <meshStandardMaterial color="#0e1216" metalness={0.2} roughness={0.55} />
        <Edges threshold={20} color={COLOR.wire} />
      </RoundedBox>
      {FACES.map((face, i) => (
        <group key={face.id} position={face.position} rotation={face.rotation}>
          <mesh>
            <planeGeometry args={[0.86, 0.86]} />
            <meshStandardMaterial
              ref={(el) => {
                panelMats.current[i] = el;
              }}
              color="#0a0f12"
              emissive={COLOR.petrol}
              emissiveIntensity={0.18}
              roughness={0.5}
              metalness={0.1}
              toneMapped={false}
            />
          </mesh>
          {textures && (
            <mesh position={[0, 0, EPS]}>
              <planeGeometry args={[0.66, 0.66]} />
              <meshBasicMaterial
                ref={(el) => {
                  letterMats.current[i] = el;
                }}
                map={textures[face.id]}
                transparent
                depthWrite={false}
                color={COLOR.petrolBright}
                toneMapped={false}
              />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}
