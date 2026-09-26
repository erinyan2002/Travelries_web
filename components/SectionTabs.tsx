"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Images, MapPin, ScanFace, Bookmark, Newspaper, FolderHeart, CircleUserRound, ChartColumn,
} from "lucide-react";

// The bottom nav has five tabs; the pages behind three of them are grouped here
// as a segmented bar at the top of each page. Routes stay separate (/faces, /saved,
// /stats, …), so notification and share links keep working. The bar sits above the
// PageHero so it holds still when switching between siblings with different heroes.
type Tab = { key: string; label: string; icon: React.ElementType; href: string };

export const SECTIONS = {
  albums: [
    { key: "photos", label: "Photos", icon: Images,   href: "/albums" },
    { key: "trips",  label: "Trips",  icon: MapPin,   href: "/albums?view=trips" },
    { key: "people", label: "People", icon: ScanFace, href: "/faces" },
    { key: "saved",  label: "Saved",  icon: Bookmark, href: "/saved" },
  ],
  social: [
    { key: "feed",   label: "Feed",   icon: Newspaper,   href: "/feed" },
    { key: "collab", label: "Collab", icon: FolderHeart, href: "/collab" },
  ],
  profile: [
    { key: "profile", label: "Profile",    icon: CircleUserRound, href: "/profile" },
    { key: "stats",   label: "Statistics", icon: ChartColumn,     href: "/stats" },
  ],
} satisfies Record<string, Tab[]>;

export default function SectionTabs({
  section,
  active,
  onSelect,
}: {
  section: keyof typeof SECTIONS;
  active: string;
  /** Tabs handled in-page (Albums' Photos/Trips switch views without a reload). */
  onSelect?: Partial<Record<string, () => void>>;
}) {
  const tabs: Tab[] = SECTIONS[section];
  return (
    <nav className="flex gap-1 p-1 mb-4 bg-white/80 backdrop-blur-sm rounded-2xl border border-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_20px_-14px_rgba(3,105,161,0.3)]">
      {tabs.map(({ key, label, icon: Icon, href }) => {
        const isActive = key === active;
        const handler = onSelect?.[key];
        const cls = `relative flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[13px] font-bold transition-colors ${
          isActive ? "text-white" : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"}`;
        const inner = (
          <>
            {isActive && (
              <motion.span
                layoutId={`section-tab-${section}`}
                className="absolute inset-0 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 shadow-md shadow-blue-300/50"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <Icon size={15} strokeWidth={2.2} className="relative flex-shrink-0" />
            <span className="relative truncate">{label}</span>
          </>
        );
        return handler ? (
          <button key={key} type="button" onClick={handler} aria-current={isActive ? "page" : undefined} className={cls}>
            {inner}
          </button>
        ) : (
          <Link key={key} href={href} aria-current={isActive ? "page" : undefined} className={cls}>
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
