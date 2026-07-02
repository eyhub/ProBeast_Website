import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Leva, useControls, folder } from 'leva';
import { NoToneMapping, type Mesh, type ShaderMaterial } from 'three';
import { PS1Pipeline } from './PS1Pipeline';
import { createPS1Material, makeSharedUniforms, type SharedUniforms } from './ps1Material';
import { createBackgroundMaterial } from './backgroundMaterial';
import { makeCubeTexture, makeGroundTexture, setTextureFilter } from './textures';

/** Rotating rainbow gradient + grain, behind the scene (into the low-res FBO). */
function BackgroundGradient() {
  const mat = useMemo(() => createBackgroundMaterial(), []);
  useFrame((state) => {
    mat.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return (
    <mesh renderOrder={-1} frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

function CameraRig() {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    camera.lookAt(0, 1.5, 0);
  }, [camera]);
  return null;
}

/** Pointer in NDC (-1..1), read from a window listener so it works regardless
    of the portal / manual render loop (R3F's state.pointer doesn't reach
    portaled objects here). */
function usePointerNDC() {
  const ndc = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      ndc.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      ndc.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  return ndc;
}

function FloatingCube({ material }: { material: ShaderMaterial }) {
  const ref = useRef<Mesh>(null);
  const pointer = usePointerNDC();
  // spring state for each rotation axis (angle + angular velocity)
  const spring = useRef({ x: 0, y: 0, vx: 0, vy: 0 });

  useFrame((_, delta) => {
    const cube = ref.current;
    if (!cube) return;
    const dt = Math.min(delta, 1 / 30); // guard against frame spikes

    // Rotation target derived from cursor location (yaw from x, pitch from y).
    const targetY = pointer.current.x * 0.75;
    const targetX = -pointer.current.y * 0.55;

    // Underdamped spring (damping well below critical ≈ 2√k) → momentum +
    // overshoot = noticeable weight, instead of snapping to the target.
    const k = 16; // stiffness
    const c = 3.4; // damping
    const s = spring.current;
    s.vy += (-k * (s.y - targetY) - c * s.vy) * dt;
    s.vx += (-k * (s.x - targetX) - c * s.vx) * dt;
    s.y += s.vy * dt;
    s.x += s.vx * dt;

    cube.rotation.y = s.y;
    cube.rotation.x = s.x;
  });

  // Absolute position stays fixed; only rotation responds to the cursor.
  return (
    <mesh ref={ref} position={[0, 1.6, 0]}>
      <boxGeometry args={[1.6, 1.6, 1.6]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

interface WorldProps {
  shared: SharedUniforms;
  snapAmt: number;
  affineAmt: number;
  fogFar: number;
  nearest: boolean;
}

function World({ shared, snapAmt, affineAmt, fogFar, nearest }: WorldProps) {
  const groundTex = useMemo(() => makeGroundTexture(), []);
  const cubeTex = useMemo(() => makeCubeTexture(), []);
  const groundMat = useMemo(() => createPS1Material(shared, groundTex), [shared, groundTex]);
  const cubeMat = useMemo(() => createPS1Material(shared, cubeTex), [shared, cubeTex]);

  useEffect(() => void (shared.uSnapAmt.value = snapAmt), [snapAmt, shared]);
  useEffect(() => void (shared.uAffineAmt.value = affineAmt), [affineAmt, shared]);
  useEffect(() => void (shared.uFogFar.value = fogFar), [fogFar, shared]);
  useEffect(() => {
    setTextureFilter(groundTex, nearest);
    setTextureFilter(cubeTex, nearest);
  }, [nearest, groundTex, cubeTex]);

  return (
    <>
      <CameraRig />
      <BackgroundGradient />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[60, 60, 8, 8]} />
        <primitive object={groundMat} attach="material" />
      </mesh>
      <FloatingCube material={cubeMat} />
    </>
  );
}

export function PS1Lab() {
  const shared = useMemo(() => makeSharedUniforms(), []);

  const c = useControls({
    Pixelation: folder({
      pixelation: { value: true, label: 'enabled' },
      internalHeight: { value: 240, min: 64, max: 480, step: 2, label: 'internal res (px)' },
    }),
    Jitter: folder({
      jitterOn: { value: true, label: 'enabled' },
      snap: { value: 1, min: 0, max: 1, step: 0.01, label: 'strength' },
    }),
    'Affine warp': folder({
      affineOn: { value: true, label: 'enabled' },
      affine: { value: 1, min: 0, max: 1, step: 0.01, label: 'strength' },
    }),
    Color: folder({
      quantize: { value: true, label: 'quantize' },
      levels: { value: 32, min: 4, max: 64, step: 1, label: 'levels' },
      ditherOn: { value: true, label: 'dither' },
      ditherAmt: { value: 1, min: 0, max: 1, step: 0.01, label: 'dither amount' },
    }),
    Fog: folder({
      fogOn: { value: true, label: 'enabled' },
      fogFar: { value: 38, min: 10, max: 60, step: 1, label: 'far distance' },
    }),
    Textures: folder({
      nearest: { value: true, label: 'nearest filter' },
    }),
  });

  const snapAmt = c.jitterOn ? c.snap : 0;
  const affineAmt = c.affineOn ? c.affine : 0;
  const levels = c.quantize ? c.levels : 256;
  const dither = c.ditherOn ? c.ditherAmt : 0;
  const fogFar = c.fogOn ? c.fogFar : 1e9;

  return (
    <>
      <Leva collapsed={false} />
      <Canvas
        dpr={1}
        gl={{ antialias: false }}
        camera={{ position: [5.5, 4, 7], fov: 50 }}
        onCreated={({ gl }) => {
          gl.toneMapping = NoToneMapping;
        }}
      >
        <PS1Pipeline
          shared={shared}
          pixelation={c.pixelation}
          internalHeight={c.internalHeight}
          levels={levels}
          dither={dither}
        >
          <World
            shared={shared}
            snapAmt={snapAmt}
            affineAmt={affineAmt}
            fogFar={fogFar}
            nearest={c.nearest}
          />
        </PS1Pipeline>
      </Canvas>
    </>
  );
}
