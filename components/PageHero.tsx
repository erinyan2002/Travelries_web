"use client";

import { ReactNode } from "react";
import { motion } from "framer-motion";

// Shared pastel-sky-blue banner used at the top of every main page (Home,
// Stats, Albums, Feed, Map, Faces, Saved, Profile, Collab) — keeps the same
// soft gradient + icon badge + title/subtitle/action layout everywhere
// instead of each page re-implementing its own header treatment.
export default function PageHero({
  icon: Icon,
  title,
  subtitle,
  action,
  iconGradient = "from-sky-400 to-blue-500",
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  iconGradient?: string;
  children?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-100/90 via-white/80 to-indigo-100/80 backdrop-blur-sm border border-white px-5 py-4 sm:px-6 sm:py-5 mb-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(3,105,161,0.3)]"
    >
      <div className="absolute -top-12 -right-10 w-44 h-44 bg-sky-200/60 rounded-full blur-3xl" />
      <div className="absolute -bottom-16 -left-10 w-44 h-44 bg-indigo-200/40 rounded-full blur-3xl" />
      <div className="absolute top-4 right-24 w-24 h-24 bg-pink-200/30 rounded-full blur-2xl" />
      {/* Faint dot grid — a map-paper texture */}
      <div
        className="absolute inset-0 opacity-[0.35] pointer-events-none"
        style={{ backgroundImage: "radial-gradient(rgba(14,116,144,0.18) 1px, transparent 1px)", backgroundSize: "16px 16px",
                 maskImage: "linear-gradient(to left, black, transparent 70%)", WebkitMaskImage: "linear-gradient(to left, black, transparent 70%)" }}
      />
      <div className="relative flex flex-wrap sm:flex-nowrap items-center gap-x-3.5 gap-y-3">
        {/* Compact badge (no ring/offset — that read as oversized and bled into the
            title). Pops in on load; on hover it lifts and a light sheen sweeps
            across — responsive without the crooked-looking tilt. */}
        <motion.div
          initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          whileHover={{ y: -3, scale: 1.07 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: "spring", stiffness: 380, damping: 18 }}
          className={`group relative overflow-hidden w-10 h-10 sm:w-11 sm:h-11 bg-gradient-to-br ${iconGradient} rounded-[14px] flex items-center justify-center flex-shrink-0 shadow-md shadow-sky-300/50 hover:shadow-lg hover:shadow-sky-300/70 transition-shadow cursor-default`}
        >
          {/* gloss */}
          <span className="absolute inset-x-1 top-0.5 h-1/2 rounded-t-[12px] bg-gradient-to-b from-white/35 to-transparent pointer-events-none" />
          {/* sheen sweep on hover */}
          <span className="absolute inset-y-0 -left-full w-full bg-gradient-to-r from-transparent via-white/50 to-transparent skew-x-[-20deg] transition-transform duration-700 ease-out group-hover:translate-x-[200%] pointer-events-none" />
          <Icon size={20} strokeWidth={2.2} className="relative text-white drop-shadow-sm transition-transform duration-300 group-hover:scale-110" />
        </motion.div>
        <div className="flex-1 min-w-0">
          <h1 className="text-[22px] sm:text-[26px] leading-tight font-extrabold text-slate-800 tracking-tight">{title}</h1>
          {subtitle && <p className="text-slate-500 text-sm mt-0.5 line-clamp-2">{subtitle}</p>}
        </div>
        {/* Phones: actions drop to their own row under the title (indented to line
            up with it) instead of squeezing the title into "Collab Albu…". */}
        {action && <div className="w-full sm:w-auto pl-[54px] sm:pl-0 flex-shrink-0">{action}</div>}
      </div>
      {children && <div className="relative mt-5">{children}</div>}
    </motion.div>
  );
}
