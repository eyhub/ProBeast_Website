/* Shared scene constants: grid layout, colors, camera, and the master timeline.
   Every phase reads its slice from PHASES; retime the whole sequence here. */

import { Vector3 } from 'three';

/* ---- Grid (cubes sit on the xz floor, extrude +y) ----------------------- */
export const COLS = 9; // odd → true center column
export const ROWS = 9; // odd → true center row
export const CELL = 1; // world units per cell
export const CENTER_COL = (COLS - 1) / 2;
export const CENTER_ROW = (ROWS - 1) / 2;

/** World position of a cell's footprint center on the floor (y handled per use). */
export function cellPosition(col: number, row: number): [number, number, number] {
  const x = (col - CENTER_COL) * CELL;
  const z = (row - CENTER_ROW) * CELL;
  return [x, 0, z];
}

export const GRID_HALF_X = (COLS * CELL) / 2;
export const GRID_HALF_Z = (ROWS * CELL) / 2;

/* ---- Camera (fixed isometric, orthographic) ----------------------------- */
// Symmetric x/z so world-down projects to straight-down on screen.
export const ISO_DIR = new Vector3(1, 0.82, 1).normalize();
export const CAM_DISTANCE = 24;
export const CAM_TARGET = new Vector3(0, 0.5, 0);
export const CAM_ZOOM = 78; // tuned in HeroCanvas for viewport fit

/* ---- Colors ------------------------------------------------------------- */
export const COLOR = {
  bg: '#06080a',
  petrol: '#00a99d', // logo SVG .cls-4
  petrolBright: '#19e9d2',
  white: '#eef2f4',
  wire: '#dfe9ec',
  glyph: '#7fe9da', // cool teal-white for the rain
} as const;

/* ---- Master timeline (seconds) ------------------------------------------ */
export const PHASES = {
  rain: { start: 0.0, end: 1.0 },
  arc: { start: 0.7, end: 1.4 }, // overlaps tail of rain
  form: { start: 1.4, end: 1.9 }, // center highlighted
  sweep: { start: 1.9, end: 2.1 },
  morph: { start: 2.2, end: 2.7 },
  jump: { start: 2.7, end: 2.9 }, // 3 weighted hops
  settle: { start: 2.9, end: 3.2 },
} as const;

export const HOPS = 3;
export const TIMELINE_TOTAL = 3.2; // includes a short tail before idle hold

export type PhaseName = keyof typeof PHASES;
