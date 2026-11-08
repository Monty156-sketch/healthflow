"use client";

// Motion helpers for the platform console. Everything here respects the person's
// "reduce motion" setting: with it on, content simply appears.
import { animate, motion, MotionConfig, useInView, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Each console page eases in when you move between pages. */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.div key={pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
      {children}
    </motion.div>
  );
}

/** Children rise in one after another. Wrap each child in <StaggerItem>. */
export function Stagger({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: delay } } }}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } } }}>
      {children}
    </motion.div>
  );
}

/** A card that lifts a little under the finger or pointer. */
export function Lift({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} whileHover={{ y: -3 }} whileTap={{ scale: 0.985 }} transition={{ type: "spring", stiffness: 400, damping: 28 }}>
      {children}
    </motion.div>
  );
}

/** A number that counts up to its value the first time it is seen. */
export function CountUp({ value, format }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const fmt = format ?? ((n: number) => String(Math.round(n)));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (reduce || !seen) return;
    const c = animate(0, value, { duration: 0.9, ease: EASE, onUpdate: (n) => setShown(n) });
    return () => c.stop();
  }, [seen, value, reduce]);
  const current = reduce ? value : shown;
  return (
    <span ref={ref} aria-label={fmt(value)}>
      <span aria-hidden="true">{fmt(current)}</span>
    </span>
  );
}
