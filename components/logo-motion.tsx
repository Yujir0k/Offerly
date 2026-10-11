"use client";
export function LogoMotion({
  size = 48,
  mode = "loop",
  className = "",
}: {
  size?: number;
  mode?: "loop" | "assemble" | "static";
  className?: string;
}) {
  return (
    <span
      className={`logo-motion logo-motion-${mode} ${className}`}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="0 0 410 410" fill="none">
        <path
          className="logo-piece logo-piece-left"
          fill="#EDEDED"
          d="M70 0 H101 Q117 0 113 16 C98 63 131 89 174 116 C219 143 260 163 260 201 C260 240 223 257 184 284 C146 309 133 343 139 379 Q145 410 126 410 H70 C31 410 0 379 0 340 V70 C0 31 31 0 70 0 Z"
        />
        <path
          className="logo-piece logo-piece-red"
          fill="#EC1D35"
          d="M189 0 H340 C379 0 410 31 410 70 V176 Q410 194 392 194 H341 Q320 194 314 174 C297 137 270 125 222 96 C184 74 167 57 170 38 Q173 0 189 0 Z"
        />
        <path
          className="logo-piece logo-piece-purple"
          fill="#402FFF"
          d="M340 238 H390 Q410 238 410 258 V340 C410 379 379 410 340 410 H220 Q203 410 201 394 C191 351 224 313 263 289 C291 273 308 260 316 248 Q324 238 340 238 Z"
        />
      </svg>
    </span>
  );
}

export function BrandGraphic({ className = "" }: { className?: string }) {
  return (
    <div className={`brand-graphic ${className}`} aria-hidden="true">
      <svg className="brand-graphic-orbit" viewBox="0 0 300 220" fill="none">
        <ellipse
          cx="151"
          cy="110"
          rx="132"
          ry="69"
          transform="rotate(-26 151 110)"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <circle cx="251" cy="39" r="11" fill="#EC1D35" />
        <rect
          x="35"
          y="152"
          width="24"
          height="24"
          rx="7"
          fill="#9F81ED"
          transform="rotate(15 35 152)"
        />
        <circle cx="100" cy="32" r="4" fill="#B6A3F3" />
      </svg>
      <LogoMotion mode="static" size={106} />
    </div>
  );
}
