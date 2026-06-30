import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { NoToneMapping, type OrthographicCamera } from 'three';
import { CAM_DISTANCE, CAM_TARGET, COLOR, ISO_DIR } from './hero/constants';
import { ClockProvider, type HeroClock } from './hero/clock';
import { makeGlyphAtlas } from './hero/glyphCanvas';
import { RainField } from './hero/RainField';
import { CellGlyphs } from './hero/CellGlyphs';
import { LightArc } from './hero/LightArc';
import { WireGrid } from './hero/WireGrid';
import { LogoCube } from './hero/LogoCube';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-*/=<>%#&@$:.';

/** Fixed isometric orthographic rig; refits zoom to the viewport. */
function CameraRig() {
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const size = useThree((s) => s.size);

  useLayoutEffect(() => {
    camera.position.copy(ISO_DIR).multiplyScalar(CAM_DISTANCE);
    camera.up.set(0, 1, 0);
    camera.lookAt(CAM_TARGET);
    const zoom = Math.min(size.width, size.height) / 13;
    camera.zoom = Math.max(40, Math.min(110, zoom));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  return null;
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[6, 10, 8]} intensity={1.1} />
      <directionalLight position={[-8, 4, -6]} intensity={0.4} color="#9fb6c4" />
    </>
  );
}

interface HeroCanvasProps {
  runId: number;
  onSettle: (settled: boolean) => void;
}

export function HeroCanvas({ runId, onSettle }: HeroCanvasProps) {
  const clockRef = useRef<HeroClock>({ t: 0 });
  const atlas = useMemo(() => makeGlyphAtlas(CHARSET), []);

  useEffect(() => () => atlas.texture.dispose(), [atlas]);

  return (
    <Canvas
      orthographic
      dpr={[1, 2]}
      gl={{ antialias: true }}
      camera={{ position: [CAM_DISTANCE, CAM_DISTANCE, CAM_DISTANCE], zoom: 70, near: 0.1, far: 200 }}
      onCreated={({ gl }) => {
        gl.toneMapping = NoToneMapping;
      }}
    >
      <color attach="background" args={[COLOR.bg]} />
      <CameraRig />
      <Lights />
      <ClockProvider clockRef={clockRef} runId={runId} onSettle={onSettle}>
        <RainField atlas={atlas} />
        <CellGlyphs atlas={atlas} />
        <LightArc />
        <WireGrid />
        <LogoCube />
      </ClockProvider>
      <EffectComposer>
        <Bloom intensity={0.9} luminanceThreshold={0.18} luminanceSmoothing={0.5} mipmapBlur />
        <Vignette offset={0.32} darkness={0.82} eskil={false} />
      </EffectComposer>
    </Canvas>
  );
}
