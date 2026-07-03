import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AnimationMixer, type AnimationClip, type Object3D } from 'three';

interface SceneAnimationOptions {
  playing: boolean;
  speed: number;
}

/**
 * AnimationMixer for node/TRS clips (PRD WS4). All clips loop by default — this site's
 * animations are ambient loopers. Updates at priority 0, before the PS1 pipeline's
 * priority-1 render, so transforms are settled when the frame rasterizes.
 */
export function useSceneAnimations(
  root: Object3D | null,
  clips: AnimationClip[],
  { playing, speed }: SceneAnimationOptions
): AnimationMixer | null {
  const mixer = useMemo(() => (root ? new AnimationMixer(root) : null), [root]);

  useEffect(() => {
    if (!mixer || clips.length === 0) return;
    for (const clip of clips) mixer.clipAction(clip).play();
    return () => {
      mixer.stopAllAction();
      for (const clip of clips) mixer.uncacheClip(clip);
    };
  }, [mixer, clips]);

  useEffect(() => {
    if (mixer) mixer.timeScale = playing ? speed : 0;
  }, [mixer, playing, speed]);

  useFrame((_, delta) => {
    mixer?.update(Math.min(delta, 1 / 30)); // guard against frame spikes
  }, 0);

  return mixer;
}
