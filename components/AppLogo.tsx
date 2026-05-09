import { Aperture } from "lucide-react";

type Size = "xs" | "sm" | "md" | "lg" | "xl";

const cfg: Record<Size, { box: string; icon: number; rx: number; stroke: number }> = {
  xs: { box: "w-6  h-6",  icon: 12, rx: 7,  stroke: 1.8 },
  sm: { box: "w-8  h-8",  icon: 16, rx: 9,  stroke: 1.7 },
  md: { box: "w-10 h-10", icon: 20, rx: 11, stroke: 1.6 },
  lg: { box: "w-14 h-14", icon: 28, rx: 14, stroke: 1.5 },
  xl: { box: "w-20 h-20", icon: 40, rx: 18, stroke: 1.4 },
};

interface AppLogoProps {
  size?: Size;
  className?: string;
}

export default function AppLogo({ size = "md", className = "" }: AppLogoProps) {
  const { box, icon, rx, stroke } = cfg[size];
  return (
    <div
      className={`${box} flex-shrink-0 relative flex items-center justify-center overflow-hidden ${className}`}
      style={{ borderRadius: rx }}
    >
      {/* Base gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600" />
      {/* Top-left shimmer */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
      {/* Bottom-right depth */}
      <div className="absolute inset-0 bg-gradient-to-tl from-indigo-700/30 to-transparent" />
      <Aperture
        size={icon}
        strokeWidth={stroke}
        className="relative z-10 text-white drop-shadow-sm"
      />
    </div>
  );
}
