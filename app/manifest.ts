import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TravelLens",
    short_name: "TravelLens",
    description: "Photo map & face detection app",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#3b82f6",
    orientation: "portrait",
    icons: [
      {
        src: "/pwa-icon?s=192",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/pwa-icon?s=512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
