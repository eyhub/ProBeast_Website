/* Easing helpers — pure functions on normalized t (0..1).
   Curve values mirror the CSS tokens / emil-design-eng. */

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Inverse-lerp + clamp: maps [start,end] -> [0,1]. */
export function progress(value: number, start: number, end: number): number {
  if (end === start) return value >= end ? 1 : 0;
  return clamp01((value - start) / (end - start));
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export const easeInCubic = (t: number): number => t * t * t;

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Strong ease-out matching cubic-bezier(0.23,1,0.32,1) closely enough. */
export const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, 5);

export const easeInExpo = (t: number): number => (t === 0 ? 0 : Math.pow(2, 10 * t - 10));

/** Overshoot — for snappy reveals. s controls the overshoot amount. */
export function easeOutBack(t: number, s = 1.70158): number {
  const c3 = s + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
}

/** Smoothstep between edges. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Parabolic arc: 0 at t=0 and t=1, peak 1 at t=0.5. For jump height. */
export const parabola = (t: number): number => 4 * t * (1 - t);

/**
 * A weighted jump height curve: quick launch (decelerating up like gravity),
 * brief hang, then accelerating fall — i.e. a real ballistic arc, asymmetric
 * so it reads as "with weight". Returns height 0..1.
 */
export function jumpArc(t: number): number {
  const x = clamp01(t);
  // up phase decelerates (ease-out), down phase accelerates (ease-in)
  if (x < 0.45) {
    return easeOutCubic(x / 0.45);
  }
  return 1 - easeInCubic((x - 0.45) / 0.55);
}
