"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  House, MapPinned, Images, Newspaper, FolderHeart, ScanFace, Bookmark, ChartColumn, CircleUserRound, LogOut,
  LayoutGrid, Wand2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type NavItem = { href: string; icon: React.ElementType; label: string };

const navItems: NavItem[] = [
  { href: "/",        icon: House,           label: "Home"    },
  { href: "/map",     icon: MapPinned,       label: "Map"     },
  { href: "/albums",  icon: Images,          label: "Albums"  },
  { href: "/feed",    icon: Newspaper,       label: "Feed"    },
  { href: "/collab",  icon: FolderHeart,     label: "Collab"  },
  { href: "/faces",   icon: ScanFace,        label: "Faces"   },
  { href: "/saved",   icon: Bookmark,        label: "Saved"   },
  { href: "/stats",   icon: ChartColumn,     label: "Stats"   },
  { href: "/profile", icon: CircleUserRound, label: "Profile" },
];

// Phones: nine tabs don't fit, and a sideways-scrolling bar hid half of them.
// Show the five most-used tabs plus "More", which opens a sheet with the rest.
const PHONE_TABS = ["/", "/map", "/albums", "/feed", "/faces"];
const moreItems: NavItem[] = [
  ...navItems.filter((i) => !PHONE_TABS.includes(i.href)),
  { href: "/cleanup", icon: Wand2, label: "Clean up" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

const barClass =
  "bg-white/80 backdrop-blur-xl border border-white/90 rounded-[28px] px-2 py-1.5 " +
  "shadow-[0_2px_6px_rgba(15,23,42,0.06),0_18px_40px_-16px_rgba(3,105,161,0.35)] flex items-center";

function TabIcon({ icon: Icon, active, label, bubbleId }: { icon: React.ElementType; active: boolean; label: string; bubbleId: string }) {
  return (
    <>
      <motion.span whileTap={{ scale: 0.88 }} className="relative w-10 h-10 flex items-center justify-center">
        {active && (
          <motion.span
            layoutId={bubbleId}
            className="absolute inset-0 rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 shadow-md shadow-blue-300/60"
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
          />
        )}
        <Icon
          size={20}
          strokeWidth={active ? 2.2 : 1.8}
          className={`relative z-10 transition-colors ${active ? "text-white" : "text-slate-400 group-hover:text-slate-700"}`}
        />
      </motion.span>
      <span className={`text-[10.5px] tracking-tight transition-colors ${
        active ? "font-bold text-blue-700" : "font-medium text-slate-400 group-hover:text-slate-600"}`}>
        {label}
      </span>
    </>
  );
}

export default function BottomNav() {
  const pathname = usePathname();
  const router   = useRouter();
  const barRef   = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = moreItems.some((i) => isActive(pathname, i.href));

  // Between sm and ~700px the full bar can still overflow — keep the active tab visible.
  useEffect(() => {
    const active = barRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [pathname]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <>
      {/* ── Phone "More" sheet ── */}
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              key="more-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMoreOpen(false)}
              className="sm:hidden fixed inset-0 z-40 tv-overlay"
            />
            <motion.div
              key="more-sheet"
              initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              className="sm:hidden fixed left-3 right-3 bottom-[92px] z-50 tv-modal p-3"
            >
              <div className="grid grid-cols-3 gap-2">
                {moreItems.map(({ href, icon: Icon, label }) => {
                  const active = isActive(pathname, href);
                  return (
                    <Link key={href} href={href} onClick={() => setMoreOpen(false)}
                      className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl transition-colors ${
                        active ? "bg-gradient-to-br from-sky-50 to-indigo-50 ring-1 ring-sky-200" : "hover:bg-slate-50"}`}>
                      <span className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
                        active ? "bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-md shadow-blue-300/60" : "bg-slate-100 text-slate-500"}`}>
                        <Icon size={19} strokeWidth={2} />
                      </span>
                      <span className={`text-xs ${active ? "font-bold text-blue-700" : "font-semibold text-slate-600"}`}>{label}</span>
                    </Link>
                  );
                })}
              </div>
              <button onClick={handleLogout}
                className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-bold text-red-500 hover:bg-red-50 transition-colors">
                <LogOut size={16} /> Log out
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <motion.nav
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="fixed bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 w-[min(820px,calc(100%-24px))] z-50"
      >
        {/* Phone bar: 5 tabs + More, evenly spread — nothing scrolls off-screen. */}
        <div className={`sm:hidden ${barClass} justify-between`}>
          {navItems.filter((i) => PHONE_TABS.includes(i.href)).map(({ href, icon, label }) => {
            const active = !moreOpen && isActive(pathname, href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}
                className="group flex-1 flex flex-col items-center gap-0.5 py-1">
                <TabIcon icon={icon} active={active} label={label} bubbleId="phone-nav-bubble" />
              </Link>
            );
          })}
          <button type="button" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}
            className="group flex-1 flex flex-col items-center gap-0.5 py-1">
            <TabIcon icon={LayoutGrid} active={moreOpen || moreActive} label="More" bubbleId="phone-nav-bubble" />
          </button>
        </div>

        {/* Tablet/desktop bar: every tab. */}
        <div ref={barRef} className={`hidden sm:flex no-scrollbar ${barClass} overflow-x-auto`}>
          {navItems.map(({ href, icon, label }) => {
            const active = isActive(pathname, href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}
                className="group relative flex-shrink-0 w-[68px] flex flex-col items-center gap-0.5 py-1">
                <TabIcon icon={icon} active={active} label={label} bubbleId="bottom-nav-active-bubble" />
              </Link>
            );
          })}

          <span className="w-px h-8 bg-slate-200 mx-1 flex-shrink-0" />
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={handleLogout}
            title="Log out"
            aria-label="Log out"
            className="w-10 h-10 flex items-center justify-center rounded-2xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0 mx-1"
          >
            <LogOut size={18} strokeWidth={1.8} />
          </motion.button>
        </div>
      </motion.nav>
    </>
  );
}
