import { Variants } from "framer-motion";

// Shared entrance variants — a card/section fades up into place, its children
// staggered slightly so a grid/list reads as one wave rather than popping in at once.
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] } },
};

export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

// Spring used for hover/tap feedback on cards and buttons — snappy, not bouncy.
export const tapSpring = { type: "spring" as const, stiffness: 400, damping: 25 };
