interface MaeLogoProps {
  size?: number;
  className?: string;
}

/**
 * Inline SVG of the Mae icon — a faceted "M" mark on a midnight-blue tile.
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
      <rect width="512" height="512" rx="112" fill="var(--mae-text)" />
      <g fill="var(--mae-lime)">
        <path d="M 128 372 L 128 156 L 220 300 L 256 220 L 128 372 Z" opacity="0.65" />
        <path d="M 220 300 L 256 220 L 292 300 L 220 300 Z" />
        <path d="M 292 300 L 256 220 L 384 372 L 384 156 L 292 300 Z" opacity="0.8" />
      </g>
    </svg>
  );
}