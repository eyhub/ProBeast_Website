import styles from './CameraButtons.module.css';

export interface CameraButtonsProps {
  cameras: { label: string; slug: string }[];
  activeIndex: number;
  onJump: (index: number) => void;
}

/** DOM overlay: one href link per baked camera. */
export function CameraButtons({ cameras, activeIndex, onJump }: CameraButtonsProps) {
  if (cameras.length === 0) return null;

  return (
    <nav className={styles.bar} aria-label="Camera views">
      <span className={styles.brand}>Probeast</span>
      {cameras.map((cam, i) => (
        <a
          key={cam.slug}
          href={`/${cam.slug}`}
          data-text={cam.label}
          className={i === activeIndex ? `${styles.link} ${styles.active}` : styles.link}
          aria-current={i === activeIndex ? 'page' : undefined}
          onClick={(e) => {
            e.preventDefault();
            onJump(i);
          }}
        >
          <span className={styles.label}>{cam.label}</span>
        </a>
      ))}
    </nav>
  );
}
