import { useEffect, useMemo, useRef, useState } from 'react';
import { useCursor } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import {
  DoubleSide,
  EdgesGeometry,
  type BufferGeometry,
  type LineSegments,
  type Quaternion,
  type Vector3,
} from 'three';

/** Petrol-bright, straight from tokens.css (--beast-petrol-bright). */
const HIGHLIGHT = '#19e9d2';

export interface OverhangHotspotProps {
  /** The plane geometry lifted from the GLB's "Point_Target_Overhang" node. */
  geometry: BufferGeometry;
  /** World-space placement decomposed from that node's matrix. */
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
  /** Fired on click — jumps the camera to the Overhang view. */
  onSelect: () => void;
}

/**
 * Invisible, clickable marker for the overhang. Renders nothing until the pointer is
 * over it; on hover it draws a dashed petrol outline + a faint fill and flips the cursor
 * to a pointer. Clicking jumps the camera to the Overhang view. The raw GLB plane is kept
 * hidden (see GarageScene) so this component is the only thing that draws or reacts here.
 */
export function OverhangHotspot({
  geometry,
  position,
  quaternion,
  scale,
  onSelect,
}: OverhangHotspotProps) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);

  // Outline of the plane's silhouette; disposed with the component.
  const edges = useMemo(() => new EdgesGeometry(geometry), [geometry]);
  useEffect(() => () => edges.dispose(), [edges]);

  // LineDashedMaterial needs per-vertex line distances computed once after mount.
  const lineRef = useRef<LineSegments>(null);
  useEffect(() => void lineRef.current?.computeLineDistances(), [edges]);

  return (
    <group position={position} quaternion={quaternion} scale={scale}>
      {/* Interaction surface — transparent (opacity 0) until hovered. */}
      <mesh
        geometry={geometry}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <meshBasicMaterial
          color={HIGHLIGHT}
          transparent
          opacity={hovered ? 0.16 : 0}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>

      {/* Dashed silhouette, shown only while hovered. */}
      <lineSegments ref={lineRef} geometry={edges} visible={hovered}>
        <lineDashedMaterial
          color={HIGHLIGHT}
          dashSize={0.15}
          gapSize={0.1}
          transparent
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}
