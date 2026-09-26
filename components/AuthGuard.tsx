"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import BottomNav from "@/components/BottomNav";

const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password"];

function isPublicPath(path: string) {
  return PUBLIC_PATHS.includes(path) || path.startsWith("/share/") || path.startsWith("/trip/");
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session && !isPublicPath(pathname)) {
        router.replace("/login");
      } else {
        setChecked(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session && !isPublicPath(pathname)) {
        router.replace("/login");
      }
    });

    return () => subscription.unsubscribe();
  }, [pathname, router]);

  if (!checked) {
    return (
      <div style={{
        minHeight: "100vh", background: "#f8fafc",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px",
      }}>
        🌍
      </div>
    );
  }

  // The nav lives here, not in each page: rendered per page it unmounted on every
  // tab switch and replayed its slide-up entrance, which made navigation feel janky.
  if (isPublicPath(pathname)) return <>{children}</>;
  return (
    <>
      {/* Room for the desktop side rail (BottomNav, lg+). */}
      <div className="lg:pl-[100px]">{children}</div>
      <BottomNav />
    </>
  );
}
