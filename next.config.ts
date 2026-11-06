import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// Dev only: let phones on the same Wi-Fi load the dev server's assets
// (Next blocks cross-origin dev requests by default). Uses this machine's
// current LAN IPv4 addresses, so it keeps working when the network changes.
const lanHosts = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => a!.address);

const nextConfig: NextConfig = {
  allowedDevOrigins: lanHosts,
  // Dev only: no persistent webpack cache. In this checkout's path ("4-2 캡디(2)")
  // webpack can't tell files changed, so a restarted dev server rebuilt from the
  // stale .next/dev/cache and new Tailwind classes never reached the CSS.
  webpack: (config, { dev }) => {
    if (dev) config.cache = false;
    return config;
  },
  // `next build` uses Turbopack, which refuses to run next to a webpack config
  // unless told this is intended; the webpack hook above only matters for
  // `next dev --webpack`.
  turbopack: {},
  // Face-detection models and the MediaPipe runtime (~26 MB) rarely change, so a
  // phone keeps them for 30 days instead of re-checking them on every visit.
  async headers() {
    const cache = [{ key: "Cache-Control", value: "public, max-age=2592000, stale-while-revalidate=86400" }];
    return [
      { source: "/models/:path*", headers: cache },
      { source: "/mediapipe-wasm/:path*", headers: cache },
    ];
  },
};

export default nextConfig;
