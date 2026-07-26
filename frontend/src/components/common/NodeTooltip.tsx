import { useState } from 'react';

export interface NodeTooltipProps {
  text: string;
  /** If true, show truncated with a "show more" toggle */
  expandable?: boolean;
  /** Optional title shown above the text */
  title?: string;
}

export function NodeTooltip({ text, expandable = true, title }: NodeTooltipProps) {
  const [expanded, setExpanded] = useState(false);

  const shouldTruncate = expandable && text.length > 120 && !expanded;

  return (
    <div
      className="absolute z-20 px-3 py-2.5 rounded-[10px] border border-mae-border shadow-lg pointer-events-none"
      style={{
        background: 'rgba(22, 22, 22, 0.9)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        maxWidth: '280px',
        minWidth: '180px',
      }}
    >
      {title && (
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-mae-muted mb-1">
          {title}
        </div>
      )}
      <div className="text-[13px] text-mae-text leading-relaxed break-words whitespace-pre-wrap">
        {shouldTruncate ? text.slice(0, 120) + '…' : text}
      </div>
      {expandable && text.length > 120 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(v => !v);
          }}
          className="mt-1 text-[11px] text-mae-accent hover:underline cursor-pointer bg-transparent border-none p-0 pointer-events-auto"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}