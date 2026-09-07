import React from "react";

interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

// All icons share the same warm gold / crimson / parchment palette as the rest
// of the dashboard. Authored from scratch (no external dependencies, no
// attribution required, royalty-free, ships in the repo).

export function SparkleIcon({ size = 16, className = "", style }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} style={style} aria-hidden="true">
      <path
        d="M 12 0 L 13.5 9 L 24 12 L 13.5 15 L 12 24 L 10.5 15 L 0 12 L 10.5 9 Z"
        fill="currentColor"
      />
    </svg>
  );
}

// Ornate corner flourish — placed at the four corners of major cards.
// Variant prop rotates the same path 0/90/180/270 degrees.
type Corner = "tl" | "tr" | "bl" | "br";
export function CornerOrnament({ corner, size = 36, className = "" }: { corner: Corner; size?: number; className?: string }) {
  const rotation: Record<Corner, number> = { tl: 0, tr: 90, br: 180, bl: 270 };
  return (
    <svg
      viewBox="0 0 36 36"
      width={size}
      height={size}
      className={`pointer-events-none ${className}`}
      style={{ transform: `rotate(${rotation[corner]}deg)` }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`co-${corner}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFE9A8" stopOpacity="0.9"/>
          <stop offset="100%" stopColor="#8B6F2C" stopOpacity="0.5"/>
        </linearGradient>
      </defs>
      {/* L-shaped frame */}
      <path d="M 2 18 L 2 2 L 18 2" stroke={`url(#co-${corner})`} strokeWidth="1.4" fill="none" strokeLinecap="round"/>
      {/* Inner flourish curl */}
      <path
        d="M 8 8 Q 10 4 14 4 Q 12 8 8 10 Q 4 12 4 14 Q 6 12 10 12"
        stroke={`url(#co-${corner})`}
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
      />
      {/* Dot accent */}
      <circle cx="4" cy="4" r="1.2" fill={`url(#co-${corner})`}/>
    </svg>
  );
}

// Full set of corner ornaments wrapped in an absolutely-positioned overlay.
export function CardCorners({ className = "" }: { className?: string }) {
  return (
    <div className={`absolute inset-0 pointer-events-none ${className}`} aria-hidden="true">
      <div className="absolute top-0 left-0"><CornerOrnament corner="tl"/></div>
      <div className="absolute top-0 right-0"><CornerOrnament corner="tr"/></div>
      <div className="absolute bottom-0 left-0"><CornerOrnament corner="bl"/></div>
      <div className="absolute bottom-0 right-0"><CornerOrnament corner="br"/></div>
    </div>
  );
}
