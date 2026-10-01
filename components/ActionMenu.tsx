"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { msg, useLang } from "@/lib/i18n";

export type ActionMenuOption = {
  value: string;
  label: string;
  leading?: ReactNode; // avatar / face chip shown before the label
  selected?: boolean;
  danger?: boolean;
};

// A chip-styled button that opens a small popover list — used instead of a
// native <select> for card actions (Faces "Merge" / "Account"), which rendered
// as an unstyleable OS dropdown. Stops click propagation so it can sit inside
// a clickable card. The popover is portaled to <body> with fixed coordinates:
// every tv-card has backdrop-filter (its own stacking context), so an in-card
// popover would be painted over by the next card. Opens upward when there isn't
// room below (e.g. above the floating BottomNav).
export default function ActionMenu({
  icon, label, title, options, onSelect, disabled = false, tone = "slate", emptyText = msg("Nothing to show"),
}: {
  icon: ReactNode;
  label: ReactNode;
  title: string;
  options: ActionMenuOption[];
  onSelect: (value: string) => void;
  disabled?: boolean;
  tone?: "slate" | "emerald";
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useLang();
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; upward: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // Fixed coordinates go stale on scroll/resize — just close.
    // (Scrolling the menu's own list doesn't count.)
    const close = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (disabled) return;
    if (!open && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      const upward = window.innerHeight - rect.bottom < 300;
      const half = 112; // w-56 / 2
      const left = Math.min(Math.max(rect.left + rect.width / 2, half + 8), window.innerWidth - half - 8);
      setPos(upward
        ? { left, bottom: window.innerHeight - rect.top + 6, upward }
        : { left, top: rect.bottom + 6, upward });
    }
    setOpen((o) => !o);
  }
  const upward = pos?.upward ?? false;

  const toneClass = tone === "emerald"
    ? "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 ring-emerald-200/70"
    : "text-slate-600 bg-slate-100/80 hover:bg-slate-200/70 ring-transparent";

  return (
    <div ref={rootRef} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-expanded={open}
        className={`w-full flex items-center justify-center gap-1 text-[11px] font-bold px-2 py-1.5 rounded-full ring-1 transition-colors disabled:opacity-50 ${toneClass}`}
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>

      {typeof document !== "undefined" && createPortal(
      <AnimatePresence>
        {open && pos && (
          <motion.div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, x: "-50%" }}
            initial={{ opacity: 0, y: upward ? 6 : -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: upward ? 6 : -6, scale: 0.97 }}
            transition={{ duration: 0.14 }}
            className="z-[3500] w-56 tv-modal p-1.5 text-left"
          >
            <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
            <div className="max-h-56 overflow-y-auto">
              {options.length === 0 && <p className="px-2.5 py-2 text-xs text-slate-400">{t(emptyText)}</p>}
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setOpen(false); onSelect(o.value); }}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-sm font-semibold transition-colors ${
                    o.danger ? "text-red-500 hover:bg-red-50" : "text-slate-700 hover:bg-sky-50"}`}
                >
                  {o.leading}
                  <span className="flex-1 truncate text-left">{o.label}</span>
                  {o.selected && <Check size={14} className="text-emerald-500 flex-shrink-0" />}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body,
      )}
    </div>
  );
}
