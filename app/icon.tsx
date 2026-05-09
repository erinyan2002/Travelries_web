import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)",
          borderRadius: 7,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(135deg, rgba(255,255,255,0.2) 0%, transparent 55%)",
        }} />
        <svg
          width={20} height={20}
          viewBox="0 0 24 24" fill="none"
          stroke="white" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round"
          style={{ position: "relative", zIndex: 1 }}
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="14.31" y1="8"  x2="20.05" y2="17.94" />
          <line x1="9.69"  y1="8"  x2="21.17" y2="8"     />
          <line x1="7.38"  y1="12" x2="13.12" y2="2.06"  />
          <line x1="9.69"  y1="16" x2="3.95"  y2="6.06"  />
          <line x1="14.31" y1="16" x2="2.83"  y2="16"    />
          <line x1="16.62" y1="12" x2="10.88" y2="21.94" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
