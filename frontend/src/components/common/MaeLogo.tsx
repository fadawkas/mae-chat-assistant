interface MaeLogoProps {
  size?: number;
  className?: string;
}

/**
 * Inline SVG of the Mae icon — a faceted "M" mark on a charcoal rounded-square.
 * Matches the mae-accent (#d8e778) palette and can be used at any size.
 */
export function MaeLogo({ size = 20, className = '' }: MaeLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="512" height="512" rx="112" fill="#1c1c1c" />
      <rect width="512" height="512" rx="112" fill="none" stroke="#333333" strokeWidth="2" />
      <path d="M 128 372 L 128 156 L 220 300 L 256 220 L 128 372 Z" fill="#d8e778" opacity="0.55" />
      <path d="M 220 300 L 256 220 L 292 300 L 220 300 Z" fill="#d8e778" opacity="0.85" />
      <path d="M 292 300 L 256 220 L 384 372 L 384 156 L 292 300 Z" fill="#d8e778" opacity="0.7" />
    </svg>
  );
}