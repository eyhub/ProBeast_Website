import { useCallback, useEffect, useRef } from 'react';

interface ScrollNavOptions {
  count: number;
  /** Fired when the section at viewport center changes (not during programmatic scroll). */
  onSectionChange: (index: number) => void;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Scroll-driven camera navigation. A fixed full-screen scroller holds one transparent
 * full-viewport section per camera; an IntersectionObserver (1px band at viewport center)
 * fires `onSectionChange` as the user scrolls. `scrollToSection` drives programmatic
 * (nav-click / popstate / init) scrolls, muting the observer mid-flight so only one
 * clean tween fires at the destination.
 */
export function useScrollNav({ count, onSectionChange }: ScrollNavOptions) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const programmaticRef = useRef(false);
  const lastIndex = useRef(-1);

  // Observe which section is centered in the scroller.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || count === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (programmaticRef.current) return;
        for (const e of entries) {
          if (e.isIntersecting) {
            const i = Number((e.target as HTMLElement).dataset.index);
            if (!Number.isNaN(i) && i !== lastIndex.current) {
              lastIndex.current = i;
              onSectionChange(i);
            }
          }
        }
      },
      { root, rootMargin: '-50% 0px -50% 0px', threshold: 0 },
    );
    for (const el of sectionRefs.current.slice(0, count)) if (el) io.observe(el);
    return () => io.disconnect();
  }, [count, onSectionChange]);

  const scrollToSection = useCallback(
    (index: number, smooth: boolean) => {
      const el = sectionRefs.current[index];
      const root = scrollerRef.current;
      if (!el || !root) return;
      // Suppress the observer for this programmatic move so it doesn't re-fire.
      programmaticRef.current = true;
      lastIndex.current = index;

      const instant = !smooth || prefersReducedMotion();
      if (instant) {
        el.scrollIntoView({ behavior: 'instant', block: 'start' });
        // Observer callbacks fire async (next frame); stay muted through two frames.
        requestAnimationFrame(() => requestAnimationFrame(() => (programmaticRef.current = false)));
        return;
      }

      // Smooth: muted for the whole flight, then one clean onSectionChange at the end.
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        root.removeEventListener('scrollend', finish);
        clearTimeout(timer);
        programmaticRef.current = false;
        onSectionChange(index);
      };
      root.addEventListener('scrollend', finish, { once: true });
      const timer = setTimeout(finish, 1500);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [onSectionChange],
  );

  return { scrollerRef, sectionRefs, scrollToSection };
}
