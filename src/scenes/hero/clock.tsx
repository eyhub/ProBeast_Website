import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { PHASES, TIMELINE_TOTAL } from './constants';

export interface HeroClock {
  /** elapsed seconds since the sequence (re)started, clamped to TIMELINE_TOTAL */
  t: number;
}

export type ClockRef = { current: HeroClock };

const ClockContext = createContext<ClockRef>({ current: { t: 0 } });

export const useHeroClock = (): ClockRef => useContext(ClockContext);

interface ClockProviderProps {
  clockRef: ClockRef;
  runId: number;
  onSettle: (settled: boolean) => void;
  children: ReactNode;
}

/** Advances the shared clock each frame and reports the settle transition. */
export function ClockProvider({ clockRef, runId, onSettle, children }: ClockProviderProps) {
  const settledRef = useRef(false);

  useEffect(() => {
    clockRef.current.t = 0;
    settledRef.current = false;
    onSettle(false);
  }, [runId, clockRef, onSettle]);

  useFrame((_, delta) => {
    const c = clockRef.current;
    c.t = Math.min(c.t + delta, TIMELINE_TOTAL);
    const settled = c.t >= PHASES.settle.start;
    if (settled !== settledRef.current) {
      settledRef.current = settled;
      onSettle(settled);
    }
  });

  return <ClockContext.Provider value={clockRef}>{children}</ClockContext.Provider>;
}
