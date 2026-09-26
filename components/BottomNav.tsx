"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { House, MapPinned, Images, UsersRound, CircleUserRound, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";

// Five tabs. Albums, Social and Profile each cover several routes, and the
// sibling pages are switched with components/SectionTabs.tsx at the top of each page.
type NavItem = { href: string; icon: React.ElementType; label: string; routes: string[] };

const navItems: NavItem[] = [
  { href: "/",        icon: House,           label: "Home",    routes: ["/"] },
  { href: "/map",     icon: MapPinned,       label: "Map",     routes: ["/map"] },
  { href: "/albums",  icon: Images,          label: "Albums",  routes: ["/albums", "/faces", "/saved", "/cleanup"] },
  { href: "/feed",    icon: UsersRound,      label: "Social",  routes: ["/feed", "/collab", "/post", "/u"] },
  { href: "/profile", icon: CircleUserRound, label: "Profile", routes: ["/profile", "/stats"] },
];

function isActive(pathname: string, item: NavItem) {
  return item.routes.some((r) => (r === "/" ? pathname === "/" : pathname === r || pathname.startsWith(r + "/")));
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

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <motion.nav
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      className="fixed bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 w-[min(520px,calc(100%-24px))] z-50"
    >
      <div className={`${barClass} justify-between`}>
        {navItems.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
              className="group flex-1 flex flex-col items-center gap-0.5 py-1">
              <TabIcon icon={item.icon} active={active} label={item.label} bubbleId="bottom-nav-bubble" />
            </Link>
          );
        })}
        {/* Desktop only — on phones, Log out lives on the Profile page. */}
        <span className="hidden sm:block w-px h-8 bg-slate-200 mx-1 flex-shrink-0" />
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={handleLogout}
          title="Log out"
          aria-label="Log out"
          className="hidden sm:flex w-10 h-10 items-center justify-center rounded-2xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0 mx-1"
        >
          <LogOut size={18} strokeWidth={1.8} />
        </motion.button>
      </div>
    </motion.nav>
  );
}
