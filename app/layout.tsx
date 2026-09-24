import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthGuard from "@/components/AuthGuard";
import NotificationBell from "@/components/NotificationBell";

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
  themeColor: "#3b82f6",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard: one typeface that pairs Korean (locations, diaries) with Latin
            UI text cleanly. Linked here rather than @import-ed in globals.css so a
            remote URL never sits in the Tailwind/PostCSS pipeline. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="antialiased">
        <AuthGuard>{children}</AuthGuard>
        <NotificationBell />
      </body>
    </html>
  );
}
