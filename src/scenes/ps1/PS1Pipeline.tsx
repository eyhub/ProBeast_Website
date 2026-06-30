import { useEffect, useMemo, type ReactNode } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { useFBO } from '@react-three/drei';
import { Camera, Color, Mesh, NearestFilter, PlaneGeometry, Scene } from 'three';
import { createPostMaterial } from './postMaterial';
import type { SharedUniforms } from './ps1Material';

interface PS1PipelineProps {
  shared: SharedUniforms;
  pixelation: boolean;
  internalHeight: number;
  levels: number;
  dither: number;
  children: ReactNode;
}

/**
 * Renders the world into a low-res FBO, then upscales (nearest) through the
 * posterize/dither post material. Snapping resolution is tied to the internal
 * height regardless of pixelation, so jitter works independently.
 */
export function PS1Pipeline({
  shared,
  pixelation,
  internalHeight,
  levels,
  dither,
  children,
}: PS1PipelineProps) {
  const { gl, size, camera } = useThree();

  const worldScene = useMemo(() => {
    const s = new Scene();
    s.background = new Color('#06080a');
    return s;
  }, []);

  const target = useFBO(320, 240, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: true,
  });

  const post = useMemo(() => createPostMaterial(), []);
  const quadScene = useMemo(() => {
    const s = new Scene();
    const m = new Mesh(new PlaneGeometry(2, 2), post);
    m.frustumCulled = false;
    s.add(m);
    return s;
  }, [post]);
  const quadCam = useMemo(() => new Camera(), []);

  useEffect(() => {
    const aspect = size.width / size.height;
    const lowW = Math.max(2, Math.round(internalHeight * aspect));
    const w = pixelation ? lowW : size.width;
    const h = pixelation ? internalHeight : size.height;
    target.setSize(w, h);
    post.uniforms.uResolution.value.set(w, h);
    shared.uSnapRes.value.set(lowW, internalHeight); // jitter grid: always the virtual res
  }, [pixelation, internalHeight, size, target, post, shared]);

  useEffect(() => {
    post.uniforms.uLevels.value = levels;
    post.uniforms.uDither.value = dither;
  }, [levels, dither, post]);

  useFrame(() => {
    gl.setRenderTarget(target);
    gl.render(worldScene, camera);
    gl.setRenderTarget(null);
    post.uniforms.uScene.value = target.texture;
    gl.render(quadScene, quadCam);
  }, 1);

  return <>{createPortal(children, worldScene)}</>;
}
