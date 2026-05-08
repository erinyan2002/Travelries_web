"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

const PUBLIC_PATHS = ["/login", "/signup"];

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session && !PUBLIC_PATHS.includes(pathname)) {
        router.replace("/login");
      } else {
        setChecked(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session && !PUBLIC_PATHS.includes(pathname)) {
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

  return <>{children}</>;
}
