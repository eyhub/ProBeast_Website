import { useEffect, useState } from 'react';

/**
 * Resolves true once the given font spec is loaded (or immediately if the
 * Font Loading API is unavailable). Spec example: "900 64px 'Eurostile Extended'".
 */
export function useFontReady(spec: string): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    if (typeof document === 'undefined' || !('fonts' in document)) {
      setReady(true);
      return;
    }
    document.fonts
      .load(spec)
      .then(() => {
        if (alive) setReady(true);
      })
      .catch(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [spec]);

  return ready;
}
