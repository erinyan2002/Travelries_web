"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Images, MapPin, Wand2, Bookmark, Newspaper, FolderHeart, CircleUserRound, ChartColumn, UsersRound,
} from "lucide-react";
import { msg, useLang } from "@/lib/i18n";

// Header for the pages grouped under one bottom-nav tab (Albums, Social, Profile):
// the section's title, then small underline tabs for its pages. It replaces a
// full PageHero on those pages, so the hierarchy reads App nav → section → tab,
// and the photos start higher up the screen. Routes stay separate (/saved,
// /cleanup, /stats, …), so notification and share links keep working.
type Tab = { key: string; label: string; icon: React.ElementType; href: string };

export const SECTIONS = {
  albums: {
    title: msg("Albums"), icon: Images,
    tabs: [
      { key: "photos",  label: msg("Photos"),   icon: Images,   href: "/albums" },
      { key: "trips",   label: msg("Trips"),    icon: MapPin,   href: "/albums?view=trips" },
      { key: "saved",   label: msg("Saved"),    icon: Bookmark, href: "/saved" },
      { key: "cleanup", label: msg("Clean up"), icon: Wand2,    href: "/cleanup" },
    ],
  },
  social: {
    title: msg("Social"), icon: UsersRound,
    tabs: [
      { key: "feed",   label: msg("Feed"),   icon: Newspaper,   href: "/feed" },
      { key: "collab", label: msg("Collab"), icon: FolderHeart, href: "/collab" },
    ],
  },
  profile: {
    title: msg("Profile"), icon: CircleUserRound,
    tabs: [
      { key: "profile", label: msg("Profile"),    icon: CircleUserRound, href: "/profile" },
      { key: "stats",   label: msg("Statistics"), icon: ChartColumn,     href: "/stats" },
    ],
  },
} satisfies Record<string, { title: string; icon: React.ElementType; tabs: Tab[] }>;

export default function SectionTabs({
  section,
  active,
  onSelect,
  action,
  subtitle,
}: {
  section: keyof typeof SECTIONS;
  active: string;
  /** Tabs handled in-page (Albums' Photos/Trips switch views without a reload). */
  onSelect?: Partial<Record<string, () => void>>;
  /** Page-specific buttons, shown at the right of the title. */
  action?: ReactNode;
  subtitle?: ReactNode;
}) {
  const { title, icon: SectionIcon, tabs } = SECTIONS[section];
  const { t } = useLang();
  return (
    <header className="mb-4">
      <div className="flex items-center gap-2.5 min-h-[40px]">
        <span className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center shadow-sm shadow-sky-300/50 flex-shrink-0">
          <SectionIcon size={16} strokeWidth={2.2} className="text-white" />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="text-[22px] leading-tight font-extrabold text-slate-800 tracking-tight">{t(title)}</h1>
          {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>

      <nav className="flex gap-1 mt-2 border-b border-slate-200/80 overflow-x-auto no-scrollbar">
        {tabs.map(({ key, label, icon: Icon, href }) => {
          const isActive = key === active;
          const handler = onSelect?.[key];
          const cls = `relative flex items-center gap-1.5 px-3 pt-2 pb-2.5 text-[13px] font-bold whitespace-nowrap transition-colors ${
            isActive ? "text-blue-700" : "text-slate-400 hover:text-slate-700"}`;
          const inner = (
            <>
              <Icon size={14} strokeWidth={2.2} />
              {t(label)}
              {isActive && (
                <motion.span
                  layoutId={`section-tab-${section}`}
                  className="absolute left-2 right-2 -bottom-px h-[3px] rounded-full bg-gradient-to-r from-sky-400 to-blue-600"
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
              )}
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
    </header>
  );
}
