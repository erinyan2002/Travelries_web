import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthGuard from "@/components/AuthGuard";
import NotificationBell from "@/components/NotificationBell";
import IntroSplash from "@/components/IntroSplash";

export const metadata: Metadata = {
  title: "Travelries",
  description: "Photo map & face detection app",
  appleWebApp: {
    capable: true,
    title: "Travelries",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#0284c7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* Pretendard: one typeface that pairs Korean (locations, diaries) with Latin
            UI text cleanly. Linked here rather than @import-ed in globals.css so a
            remote URL never sits in the Tailwind/PostCSS pipeline. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        {/* Runs before paint: skip the intro after its first showing this session,
            and for anyone who asked their OS for reduced motion.
            `?intro` in the URL always replays it (handy for demos). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(!/[?&]intro\\b/.test(location.search)&&(sessionStorage.getItem("tv-intro-seen")||matchMedia("(prefers-reduced-motion: reduce)").matches))document.documentElement.dataset.introSeen="1"}catch(e){}`,
          }}
        />
      </head>
      <body className="antialiased">
        <AuthGuard>{children}</AuthGuard>
        <NotificationBell />
        <IntroSplash />
      </body>
    </html>
  );
}
