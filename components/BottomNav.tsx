"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  House, MapPinned, Images, Newspaper, FolderHeart, ScanFace, Bookmark, ChartColumn, CircleUserRound, LogOut,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

const navItems = [
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

export default function BottomNav() {
  const pathname = usePathname();
  const router   = useRouter();
  const barRef   = useRef<HTMLDivElement>(null);

  // On a phone the bar scrolls sideways (9 tabs don't fit), so a tab like
  // Stats or Profile can be active yet off-screen — bring it into view.
  useEffect(() => {
    const active = barRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [pathname]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <motion.nav
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(820px,calc(100%-24px))] z-50"
    >
      {/* More items than fit on a phone-width screen — scroll horizontally rather than
          squeezing every item down to illegibility (fixed-width items + flex-shrink-0). */}
      <div ref={barRef} className="no-scrollbar bg-white/80 backdrop-blur-xl border border-white/90 rounded-[28px] px-2 py-1.5 shadow-[0_2px_6px_rgba(15,23,42,0.06),0_18px_40px_-16px_rgba(30,64,175,0.35)] flex items-center overflow-x-auto">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className="group relative flex-shrink-0 w-[68px] flex flex-col items-center gap-0.5 py-1"
            >
              <motion.span whileTap={{ scale: 0.88 }} className="relative w-10 h-10 flex items-center justify-center">
                {active && (
                  <motion.span
                    layoutId="bottom-nav-active-bubble"
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
  );
}
