import { useCallback, useState } from 'react';
import { motion } from 'motion/react';
import { HeroCanvas } from '../../scenes/HeroCanvas';
import styles from './Hero.module.css';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export function Hero() {
  const [runId, setRunId] = useState(0);
  const [settled, setSettled] = useState(false);

  // Stable callback so the canvas's clock effect doesn't re-fire each render.
  const onSettle = useCallback((v: boolean) => setSettled(v), []);
  const replay = () => setRunId((n) => n + 1);

  return (
    <section className={styles.hero} aria-label="ProBeast">
      <div className={styles.canvas}>
        <HeroCanvas runId={runId} onSettle={onSettle} />
      </div>

      <div className={styles.overlay}>
        <motion.h1
          className={styles.wordmark}
          initial={false}
          animate={
            settled
              ? { opacity: 1, y: 0, filter: 'blur(0px)' }
              : { opacity: 0, y: 24, filter: 'blur(8px)' }
          }
          transition={{ duration: 0.7, ease: EASE_OUT }}
        >
          ProBeast
        </motion.h1>
        <motion.p
          className={styles.tagline}
          initial={false}
          animate={{ opacity: settled ? 1 : 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT, delay: settled ? 0.18 : 0 }}
        >
          Built <strong>different</strong> — engineered to perform
        </motion.p>
      </div>

      <button className={styles.replay} onClick={replay}>
        ↻ Replay
      </button>
    </section>
  );
}
