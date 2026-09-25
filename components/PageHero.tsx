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
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-100/90 via-white/80 to-indigo-100/80 backdrop-blur-sm border border-white px-5 py-5 sm:px-6 sm:py-6 mb-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(30,64,175,0.3)]"
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
      <div className="relative flex items-center gap-3">
        <motion.div
          whileHover={{ rotate: -8, scale: 1.05 }}
          transition={{ type: "spring", stiffness: 300, damping: 15 }}
          className={`w-11 h-11 sm:w-12 sm:h-12 bg-gradient-to-br ${iconGradient} rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-sky-200 ring-4 ring-white/70`}
        >
          <Icon size={22} className="text-white" />
        </motion.div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-[28px] leading-tight font-extrabold text-slate-800 tracking-tight">{title}</h1>
          {subtitle && <p className="text-slate-500 text-sm mt-0.5 line-clamp-2">{subtitle}</p>}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {children && <div className="relative mt-5">{children}</div>}
    </motion.div>
  );
}
