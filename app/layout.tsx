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
      <body className="antialiased">
        <AuthGuard>{children}</AuthGuard>
        <NotificationBell />
      </body>
    </html>
  );
}
