"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Aperture, Plane } from "lucide-react";
import { useLang } from "@/lib/i18n";

// Brand intro shown once per browser session. It is server-rendered visible so the
// app never flashes underneath it; an inline script in app/layout.tsx marks
// <html data-intro-seen> before paint on later loads (or with reduced motion),
// and globals.css hides it from there.
const SEEN_KEY = "tv-intro-seen";
const DURATION_MS = 1900;

export default function IntroSplash() {
  const { t } = useLang();
  const [show, setShow] = useState(true);

  useEffect(() => {
    // Already seen: the CSS rule keeps it display:none, nothing to schedule.
    if (document.documentElement.dataset.introSeen) return;
    try { sessionStorage.setItem(SEEN_KEY, "1"); } catch {}
    const t = setTimeout(() => setShow(false), DURATION_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="intro"
          onClick={() => setShow(false)}
          exit={{ opacity: 0, scale: 1.06, filter: "blur(6px)" }}
          transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
          className="tv-intro fixed inset-0 z-[5000] flex flex-col items-center justify-center cursor-pointer select-none
                     bg-[radial-gradient(40rem_30rem_at_20%_10%,#bae6fd,transparent_60%),radial-gradient(36rem_28rem_at_85%_15%,#fff9e6,transparent_60%),radial-gradient(40rem_30rem_at_50%_110%,#a5f3fc,transparent_60%)] bg-[#f3f9fe]"
        >
          <div className="relative w-40 h-40 flex items-center justify-center">
            {/* dotted flight path */}
            <motion.div
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25, duration: 0.4 }}
              className="absolute inset-0 rounded-full border-2 border-dashed border-sky-300/70"
            />
            {/* plane circling the logo */}
            <motion.div
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 270, opacity: [0, 1, 1, 1, 0.9] }}
              transition={{ delay: 0.3, duration: 1.4, ease: [0.45, 0, 0.25, 1] }}
              className="absolute inset-0"
            >
              <span className="absolute left-1/2 -top-3 -translate-x-1/2 w-7 h-7 rounded-full bg-white shadow-md shadow-sky-300/60 flex items-center justify-center">
                <Plane size={15} className="text-blue-600 rotate-45" fill="currentColor" />
              </span>
            </motion.div>
            {/* the app icon */}
            <motion.div
              initial={{ scale: 0, rotate: -25 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 13 }}
              className="relative w-24 h-24 rounded-[26px] bg-gradient-to-br from-blue-700 to-blue-400 shadow-[0_18px_40px_-10px_rgba(3,105,161,0.55)] flex items-center justify-center overflow-hidden"
            >
              <span className="absolute inset-0 bg-gradient-to-br from-white/25 to-transparent" />
              <motion.span
                initial={{ rotate: -120, scale: 0.6 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ delay: 0.15, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                className="relative"
              >
                <Aperture size={56} strokeWidth={1.8} className="text-white" />
              </motion.span>
              {/* sheen sweep */}
              <motion.span
                initial={{ x: "-130%" }}
                animate={{ x: "130%" }}
                transition={{ delay: 0.7, duration: 0.7, ease: "easeInOut" }}
                className="absolute inset-y-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/45 to-transparent"
              />
            </motion.div>
          </div>

          <h1 className="mt-6 flex text-[34px] font-extrabold tracking-tight text-slate-800">
            {"Travelries".split("").map((ch, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55 + i * 0.04, type: "spring", stiffness: 420, damping: 20 }}
              >
                {ch}
              </motion.span>
            ))}
          </h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.05, duration: 0.4 }}
            className="mt-1 text-sm font-medium text-sky-700/80"
          >
            {t("Every photo, a place to remember")}
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
