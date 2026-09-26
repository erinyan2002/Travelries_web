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

// maximumScale 1: iOS zooms in when an input under 16px is focused and, in the
// home-screen app, never zooms back out — the whole page then sat enlarged and
// slid sideways. Locking the scale keeps it fitted to the phone like an app.
export const viewport: Viewport = {
  themeColor: "#0284c7",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
