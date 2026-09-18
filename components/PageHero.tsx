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
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-100 via-sky-50 to-blue-100 border border-sky-200/60 px-6 py-6 mb-6 shadow-sm"
    >
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-sky-200/50 rounded-full blur-2xl" />
      <div className="absolute -bottom-14 -left-8 w-40 h-40 bg-blue-200/40 rounded-full blur-2xl" />
      <div className="relative flex items-center gap-3">
        <motion.div
          whileHover={{ rotate: -8, scale: 1.05 }}
          transition={{ type: "spring", stiffness: 300, damping: 15 }}
          className={`w-11 h-11 bg-gradient-to-br ${iconGradient} rounded-xl flex items-center justify-center flex-shrink-0 shadow-md shadow-blue-200`}
        >
          <Icon size={22} className="text-white" />
        </motion.div>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">{title}</h1>
          {subtitle && <p className="text-slate-500 text-sm truncate">{subtitle}</p>}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {children && <div className="relative mt-5">{children}</div>}
    </motion.div>
  );
}
