"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { House, MapPinned, Images, ScanFace, UsersRound, CircleUserRound, LogOut, Aperture } from "lucide-react";
import { supabase } from "@/lib/supabase";

// App navigation: a bottom bar on phones/tablets, a left side rail on desktop (lg+;
// AuthGuard pads the content for it). People (/faces) is its own tab because face
// recognition is a core feature. Albums, Social and Profile each cover several
// routes, switched with components/SectionTabs.tsx at the top of each page.
type NavItem = { href: string; icon: React.ElementType; label: string; routes: string[] };

const navItems: NavItem[] = [
  { href: "/",        icon: House,           label: "Home",    routes: ["/"] },
  { href: "/map",     icon: MapPinned,       label: "Map",     routes: ["/map"] },
  { href: "/albums",  icon: Images,          label: "Albums",  routes: ["/albums", "/saved", "/cleanup"] },
  { href: "/faces",   icon: ScanFace,        label: "People",  routes: ["/faces"] },
  { href: "/feed",    icon: UsersRound,      label: "Social",  routes: ["/feed", "/collab", "/post", "/u"] },
  { href: "/profile", icon: CircleUserRound, label: "Profile", routes: ["/profile", "/stats"] },
];

function isActive(pathname: string, item: NavItem) {
  return item.routes.some((r) => (r === "/" ? pathname === "/" : pathname === r || pathname.startsWith(r + "/")));
}

const glass =
  "bg-white/85 backdrop-blur-xl border border-white/90 " +
  "shadow-[0_2px_6px_rgba(15,23,42,0.06),0_18px_40px_-16px_rgba(3,105,161,0.35)]";

function TabIcon({ icon: Icon, active, label, bubbleId, size }: {
  icon: React.ElementType; active: boolean; label: string; bubbleId: string; size: "sm" | "md";
}) {
  return (
    <>
      <motion.span whileTap={{ scale: 0.88 }}
        className={`relative flex items-center justify-center ${size === "sm" ? "w-9 h-8" : "w-11 h-11"}`}>
        {active && (
          <motion.span
            layoutId={bubbleId}
            className="absolute inset-0 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 shadow-md shadow-blue-300/60"
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
          />
        )}
        <Icon
          size={size === "sm" ? 18 : 20}
          strokeWidth={active ? 2.2 : 1.8}
          className={`relative z-10 transition-colors ${active ? "text-white" : "text-slate-400 group-hover:text-slate-700"}`}
        />
      </motion.span>
      <span className={`text-[10px] leading-none tracking-tight transition-colors ${
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
    <>
      {/* Phones & tablets: bottom bar */}
      <motion.nav
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="lg:hidden fixed bottom-2.5 sm:bottom-4 left-1/2 -translate-x-1/2 w-[min(560px,calc(100%-20px))] z-50"
      >
        <div className={`${glass} rounded-[22px] px-1.5 py-1 flex items-center justify-between`}>
          {navItems.map((item) => {
            const active = isActive(pathname, item);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
                className="group flex-1 flex flex-col items-center gap-1 py-1">
                <TabIcon icon={item.icon} active={active} label={item.label} bubbleId="bottom-nav-bubble" size="sm" />
              </Link>
            );
          })}
        </div>
      </motion.nav>

      {/* Desktop: side rail */}
      <motion.nav
        initial={{ x: -30, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className={`hidden lg:flex fixed left-4 top-4 bottom-4 w-[84px] z-50 flex-col items-center py-4 rounded-[28px] ${glass}`}
      >
        <Link href="/" title="Travelries"
          className="w-11 h-11 rounded-[14px] bg-gradient-to-br from-blue-700 to-blue-400 flex items-center justify-center shadow-md shadow-sky-300/60 mb-5">
          <Aperture size={22} strokeWidth={1.9} className="text-white" />
        </Link>
        <div className="flex flex-col gap-2 flex-1">
          {navItems.map((item) => {
            const active = isActive(pathname, item);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
                className="group flex flex-col items-center gap-1 py-1">
                <TabIcon icon={item.icon} active={active} label={item.label} bubbleId="side-nav-bubble" size="md" />
              </Link>
            );
          })}
        </div>
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={handleLogout}
          title="Log out"
          aria-label="Log out"
          className="w-11 h-11 flex items-center justify-center rounded-2xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <LogOut size={18} strokeWidth={1.8} />
        </motion.button>
      </motion.nav>
    </>
  );
}
