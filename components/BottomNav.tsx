"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Home, Map, Image, Users, Star, LogOut, UserCircle, BarChart2, FolderOpen, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";

const navItems = [
  { href: "/",        icon: Home,       label: "Home"    },
  { href: "/map",     icon: Map,        label: "Map"     },
  { href: "/albums",  icon: Image,      label: "Albums"  },
  { href: "/feed",    icon: Sparkles,   label: "Feed"    },
  { href: "/collab",  icon: FolderOpen, label: "Collab"  },
  { href: "/faces",   icon: Users,      label: "Faces"   },
  { href: "/saved",   icon: Star,       label: "Saved"   },
  { href: "/stats",   icon: BarChart2,  label: "Stats"   },
  { href: "/profile", icon: UserCircle, label: "Profile" },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router   = useRouter();

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
      <div className="no-scrollbar bg-white/75 backdrop-blur-xl border border-white rounded-full px-3 py-2 shadow-[0_2px_6px_rgba(15,23,42,0.06),0_18px_40px_-16px_rgba(30,64,175,0.35)] flex items-center gap-1 overflow-x-auto">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex-shrink-0 w-16 flex flex-col items-center gap-1 py-2 px-1 rounded-full transition-colors duration-150 ${
                active ? "text-sky-700" : "text-slate-500 hover:text-slate-800 hover:bg-white/70"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="bottom-nav-active-pill"
                  className="absolute inset-0 bg-gradient-to-br from-sky-100 to-indigo-100 rounded-full ring-1 ring-sky-200/70"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
              <motion.span whileTap={{ scale: 0.85 }} className="relative z-10 flex flex-col items-center gap-1">
                <Icon size={20} strokeWidth={active ? 2.5 : 2} />
                <span className={`text-[11px] font-semibold ${active ? "text-sky-700" : "text-slate-500"}`}>
                  {label}
                </span>
              </motion.span>
            </Link>
          );
        })}

        <motion.button
          whileTap={{ scale: 0.85 }}
          onClick={handleLogout}
          title="Log out"
          className="w-10 h-10 flex items-center justify-center rounded-full bg-red-50 text-red-500 hover:bg-red-100 transition-colors duration-150 flex-shrink-0 ml-1"
        >
          <LogOut size={17} strokeWidth={2} />
        </motion.button>
      </div>
    </motion.nav>
  );
}
