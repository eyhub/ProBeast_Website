import { useEffect } from 'react';
import styles from './CameraButtons.module.css';

export interface CameraButtonsProps {
  cameras: { label: string }[];
  activeIndex: number;
  onJump: (index: number) => void;
}

/** DOM overlay: one button per baked camera + number-key (1..9) shortcuts. */
export function CameraButtons({ cameras, activeIndex, onJump }: CameraButtonsProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= cameras.length) onJump(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cameras.length, onJump]);

  if (cameras.length === 0) return null;

  return (
    <nav className={styles.bar} aria-label="Camera views">
      {cameras.map((cam, i) => (
        <button
          key={cam.label}
          type="button"
          className={i === activeIndex ? `${styles.button} ${styles.active}` : styles.button}
          aria-pressed={i === activeIndex}
          onClick={() => onJump(i)}
        >
          <span className={styles.key}>{i + 1}</span>
          <span className={styles.label}>{cam.label}</span>
        </button>
      ))}
    </nav>
  );
}
