"use client";

import { useEffect, useRef } from "react";
import { useMotionValue, useTransform, animate } from "framer-motion";

// Counts up from 0 to `value` whenever `value` changes — used on stat tiles
// (dashboard, stats page) so a number landing feels like a small reveal
// rather than just appearing.
export default function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) => Math.round(v).toLocaleString());
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const controls = animate(motionValue, value, { duration: 0.6, ease: [0.16, 1, 0.3, 1] });
    return controls.stop;
  }, [value, motionValue]);

  useEffect(() => rounded.on("change", (v) => {
    if (spanRef.current) spanRef.current.textContent = v;
  }), [rounded]);

  return <span ref={spanRef} className={className}>0</span>;
}
