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
};

export default nextConfig;
