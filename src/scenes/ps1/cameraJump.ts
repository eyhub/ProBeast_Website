import { PerspectiveCamera, Quaternion, Vector3, type Object3D } from 'three';

/** A camera pose read from the GLB, used as a jump target. */
export interface CameraTarget {
  name: string;
  label: string;
  position: Vector3;
  quaternion: Quaternion;
  fov: number;
}

/** Preferred display order + friendly labels for the garage's baked cameras. */
const ORDER = ['Camera_Outside', 'Camera_Inside', 'Camera_Overhang'];

function friendly(name: string): string {
  const stripped = name.replace(/^Camera[_.]?/i, '');
  return stripped ? stripped.charAt(0).toUpperCase() + stripped.slice(1) : name;
}

/**
 * Extract world-space poses for every perspective camera in a loaded glTF scene, ordered by
 * ORDER (unknown names appended). GLTFLoader names each camera object after its node
 * (e.g. "Camera_Outside"), so we match on that.
 */
export function readGltfCameras(root: Object3D): CameraTarget[] {
  root.updateMatrixWorld(true);
  const cams: PerspectiveCamera[] = [];
  root.traverse((o) => {
    if ((o as PerspectiveCamera).isPerspectiveCamera) cams.push(o as PerspectiveCamera);
  });
  const rank = (n: string) => {
    const i = ORDER.indexOf(n);
    return i === -1 ? ORDER.length : i;
  };
  cams.sort((a, b) => rank(a.name) - rank(b.name));
  return cams.map((c) => ({
    name: c.name,
    label: friendly(c.name),
    position: c.getWorldPosition(new Vector3()),
    quaternion: c.getWorldQuaternion(new Quaternion()),
    fov: c.fov,
  }));
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Smoothly interpolates a perspective camera from its current pose to a target pose:
 * position lerp, quaternion slerp, fov lerp, on an ease-in-out-cubic curve. Frame-rate
 * independent — call `step(camera, dt)` each frame after `jumpTo(...)`.
 */
export class CameraTween {
  duration = 1;
  private t = 1;
  private readonly fromPos = new Vector3();
  private readonly toPos = new Vector3();
  private readonly fromQuat = new Quaternion();
  private readonly toQuat = new Quaternion();
  private fromFov = 50;
  private toFov = 50;

  get moving(): boolean {
    return this.t < 1;
  }

  /** Begin a transition from the camera's current pose to `target`. */
  jumpTo(camera: PerspectiveCamera, target: CameraTarget, immediate = false): void {
    this.fromPos.copy(camera.position);
    this.toPos.copy(target.position);
    this.fromQuat.copy(camera.quaternion);
    this.toQuat.copy(target.quaternion);
    this.fromFov = camera.fov;
    this.toFov = target.fov;
    if (immediate) {
      this.t = 1;
      this.apply(camera, 1);
    } else {
      this.t = 0;
    }
  }

  /** Advance the transition. No-op once complete. */
  step(camera: PerspectiveCamera, dt: number): void {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / Math.max(this.duration, 1e-3));
    this.apply(camera, easeInOutCubic(this.t));
  }

  private apply(camera: PerspectiveCamera, e: number): void {
    camera.position.lerpVectors(this.fromPos, this.toPos, e);
    camera.quaternion.slerpQuaternions(this.fromQuat, this.toQuat, e);
    camera.fov = this.fromFov + (this.toFov - this.fromFov) * e;
    camera.updateProjectionMatrix();
  }
}
