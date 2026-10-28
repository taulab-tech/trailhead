import React from 'react'

/** The Trailhead mark — the same drawing as resources/logo.svg, which the app icon is rendered from. */
export default function Logo({ size = 32 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="64 64 896 896" role="img" aria-label="Trailhead">
      <defs>
        <linearGradient id="logo-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1D4639"/>
          <stop offset="1" stopColor="#10291F"/>
        </linearGradient>
        <linearGradient id="logo-peak" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F6B470"/>
          <stop offset="1" stopColor="#E8924A"/>
        </linearGradient>
        <clipPath id="logo-tile">
          <rect x="64" y="64" width="896" height="896" rx="208"/>
        </clipPath>
      </defs>

      <rect x="64" y="64" width="896" height="896" rx="208" fill="url(#logo-sky)"/>

      <g clipPath="url(#logo-tile)">
        {/* far range */}
        <path d="M64 800 L300 520 L410 640 L520 540 L960 860 L960 960 L64 960 Z" fill="#2C5E4F"/>
        {/* main peak, lit face and shaded face */}
        <path d="M136 960 L560 330 L949 960 Z" fill="url(#logo-peak)"/>
        <path d="M560 330 L949 960 L710 960 L612 560 Z" fill="#D27A35" opacity="0.55"/>
        {/* snowcap */}
        <path d="M560 330 L493 430 L528 414 L560 446 L594 412 L630 432 Z" fill="#F7F5EF"/>
        {/* foreground hill */}
        <path d="M64 870 Q 380 790 960 900 L960 960 L64 960 Z" fill="#13302A"/>
        {/* the trail, winding up to the summit */}
        <path d="M318 960 C 360 880, 470 860, 450 780 S 600 690, 540 610 S 600 500, 560 452"
              fill="none" stroke="#F7F5EF" strokeWidth="22" strokeLinecap="round"
              strokeDasharray="1 46"/>
        {/* summit flag */}
        <path d="M560 336 L560 214" stroke="#F7F5EF" strokeWidth="16" strokeLinecap="round"/>
        <path d="M568 216 L664 246 L568 278 Z" fill="#F7F5EF"/>
      </g>
    </svg>
  )
}
