import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { LevaPanel, useControls, useCreateStore, folder } from 'leva';
import {
  Color,
  Matrix4,
  NoToneMapping,
  PointLight,
  Vector3,
  type Material,
  type Mesh,
  type PerspectiveCamera,
  type ShaderMaterial,
} from 'three';
import { PS1Pipeline } from './PS1Pipeline';
import { makeSharedUniforms, ps1MaterialFromStandard, type SharedUniforms } from './ps1Material';
import { CameraTween, readGltfCameras } from './cameraJump';
import { CameraButtons } from './CameraButtons';
import panelStyles from './RendererPanel.module.css';

const GLB_URL = '/models/test-garage.glb';
const DRACO_PATH = '/draco/';

useGLTF.preload(GLB_URL, DRACO_PATH);

interface GarageWorldProps {
  shared: SharedUniforms;
  snapAmt: number;
  affineAmt: number;
  fogFar: number;
  pointIntensity: number;
  duration: number;
  onCamerasReady: (cameras: { label: string }[]) => void;
  onActiveChange: (index: number) => void;
  registerJump: (fn: (index: number) => void) => void;
}

/** Lives inside the PS1 low-res portal: loads the GLB, PS1-ifies it, drives the camera. */
function GarageWorld({
  shared,
  snapAmt,
  affineAmt,
  fogFar,
  pointIntensity,
  duration,
  onCamerasReady,
  onActiveChange,
  registerJump,
}: GarageWorldProps) {
  const gltf = useGLTF(GLB_URL, DRACO_PATH);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;

  // Own a clone so we can swap materials without mutating the useGLTF cache.
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  // Replace every mesh material with a PS1 material (dedupe by source material).
  useMemo(() => {
    const cache = new Map<Material, ShaderMaterial>();
    const convert = (m: Material) => {
      let ps1 = cache.get(m);
      if (!ps1) {
        ps1 = ps1MaterialFromStandard(shared, m);
        cache.set(m, ps1);
      }
      return ps1;
    };
    scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(convert)
        : convert(mesh.material);
    });
  }, [scene, shared]);

  const targets = useMemo(() => readGltfCameras(scene), [scene]);

  // Point-light world position + color (drives the PS1 shading).
  const light = useMemo(() => {
    scene.updateMatrixWorld(true);
    const found: PointLight[] = [];
    scene.traverse((o) => {
      if ((o as PointLight).isPointLight) found.push(o as PointLight);
    });
    const first = found[0];
    return {
      pos: first ? first.getWorldPosition(new Vector3()) : new Vector3(0, 6, 0),
      color: first ? first.color.clone() : new Color('#ffffff'),
    };
  }, [scene]);

  const tween = useMemo(() => new CameraTween(), []);
  useEffect(() => void (tween.duration = duration), [duration, tween]);

  // Push leva-driven uniforms.
  useEffect(() => void (shared.uSnapAmt.value = snapAmt), [snapAmt, shared]);
  useEffect(() => void (shared.uAffineAmt.value = affineAmt), [affineAmt, shared]);
  useEffect(() => void (shared.uFogFar.value = fogFar), [fogFar, shared]);
  useEffect(() => void (shared.uPointIntensity.value = pointIntensity), [pointIntensity, shared]);
  useEffect(() => void shared.uPointColor.value.copy(light.color), [light, shared]);

  const jumpTo = useCallback(
    (index: number) => {
      const target = targets[index];
      if (!target) return;
      tween.jumpTo(camera, target);
      onActiveChange(index);
    },
    [targets, camera, tween, onActiveChange]
  );

  useEffect(() => void registerJump(jumpTo), [jumpTo, registerJump]);

  // Report cameras to the DOM overlay + snap to the first camera on load.
  const inited = useRef(false);
  useEffect(() => {
    onCamerasReady(targets.map((t) => ({ label: t.label })));
    if (targets.length && !inited.current) {
      inited.current = true;
      tween.jumpTo(camera, targets[0], true);
      onActiveChange(0);
    }
  }, [targets, camera, tween, onCamerasReady, onActiveChange]);

  // Advance the transition, then push the light position into the active view space.
  const inv = useMemo(() => new Matrix4(), []);
  const lightView = useMemo(() => new Vector3(), []);
  useFrame((_, dt) => {
    tween.step(camera, Math.min(dt, 1 / 30));
    camera.updateMatrixWorld();
    inv.copy(camera.matrixWorld).invert();
    lightView.copy(light.pos).applyMatrix4(inv);
    shared.uPointPosView.value.copy(lightView);
  }, 0);

  return <primitive object={scene} />;
}

export function GarageScene() {
  const shared = useMemo(() => makeSharedUniforms(), []);
  const store = useCreateStore();
  const [panelOpen, setPanelOpen] = useState(false);
  const [cameras, setCameras] = useState<{ label: string }[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const jumpRef = useRef<(index: number) => void>(() => {});
  const registerJump = useCallback((fn: (index: number) => void) => void (jumpRef.current = fn), []);

  const c = useControls(
    {
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
    Lighting: folder({
      pointIntensity: { value: 25, min: 0, max: 120, step: 1, label: 'point intensity' },
    }),
    Fog: folder({
      fogOn: { value: true, label: 'enabled' },
      fogFar: { value: 50, min: 10, max: 80, step: 1, label: 'far distance' },
    }),
      Camera: folder({
        duration: { value: 1, min: 0.1, max: 3, step: 0.05, label: 'transition (s)' },
      }),
    },
    { store },
  );

  const snapAmt = c.jitterOn ? c.snap : 0;
  const affineAmt = c.affineOn ? c.affine : 0;
  const levels = c.quantize ? c.levels : 256;
  const dither = c.ditherOn ? c.ditherAmt : 0;
  const fogFar = c.fogOn ? c.fogFar : 1e9;

  return (
    <>
      {panelOpen && (
        <div className={panelStyles.wrap}>
          <LevaPanel store={store} fill flat titleBar={false} collapsed={false} />
        </div>
      )}
      <button
        type="button"
        className={`${panelStyles.toggle} ${panelOpen ? panelStyles.open : ''}`}
        aria-expanded={panelOpen}
        aria-label="Toggle renderer controls"
        onClick={() => setPanelOpen((o) => !o)}
      >
        <svg className={panelStyles.icon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {panelOpen ? (
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ) : (
            <path
              fill="currentColor"
              d="M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zm9.4 2.6l-1.7-.4a7.9 7.9 0 00-.6-1.4l.9-1.5a.7.7 0 00-.1-.9l-1.3-1.3a.7.7 0 00-.9-.1l-1.5.9a7.9 7.9 0 00-1.4-.6l-.4-1.7a.7.7 0 00-.7-.5h-1.9a.7.7 0 00-.7.5l-.4 1.7a7.9 7.9 0 00-1.4.6l-1.5-.9a.7.7 0 00-.9.1L4.1 7.2a.7.7 0 00-.1.9l.9 1.5a7.9 7.9 0 00-.6 1.4l-1.7.4a.7.7 0 00-.5.7v1.9c0 .3.2.6.5.7l1.7.4c.2.5.4 1 .6 1.4l-.9 1.5a.7.7 0 00.1.9l1.3 1.3c.3.3.7.3 1 .1l1.4-.9c.5.2 1 .5 1.4.6l.4 1.7c.1.3.4.5.7.5h1.9c.3 0 .6-.2.7-.5l.4-1.7c.5-.2 1-.4 1.4-.6l1.5.9c.3.2.7.1 1-.1l1.3-1.3a.7.7 0 00.1-.9l-.9-1.5c.2-.4.5-.9.6-1.4l1.7-.4a.7.7 0 00.5-.7v-1.9a.7.7 0 00-.5-.7z"
            />
          )}
        </svg>
      </button>
      <Canvas
        dpr={1}
        gl={{ antialias: false }}
        camera={{ fov: 50, near: 0.1, far: 1000, position: [-13.5, 2.7, 1.3] }}
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
          <Suspense fallback={null}>
            <GarageWorld
              shared={shared}
              snapAmt={snapAmt}
              affineAmt={affineAmt}
              fogFar={fogFar}
              pointIntensity={c.pointIntensity}
              duration={c.duration}
              onCamerasReady={setCameras}
              onActiveChange={setActiveIndex}
              registerJump={registerJump}
            />
          </Suspense>
        </PS1Pipeline>
      </Canvas>
      <CameraButtons cameras={cameras} activeIndex={activeIndex} onJump={(i) => jumpRef.current(i)} />
    </>
  );
}
