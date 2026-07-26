import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeTooltip } from '../../components/common/NodeTooltip';

export type MemberNodeStatus = 'pending' | 'in_progress' | 'done' | 'error';

export interface CouncilGraphMember {
  id: string;
  model: string;
  status: MemberNodeStatus;
  error?: string;
  systemPrompt?: string;
}

export interface CouncilGraphProps {
  members: CouncilGraphMember[];
  judgeModel: string;
  judgeStatus: 'idle' | 'judging' | 'done' | 'error';
  judgeSystemPrompt?: string;
  onClick?: () => void;
  onEditMember?: (memberId: string) => void;
  idle?: boolean;
  placeholderCount?: number;
}

interface NodePos {
  x: number;
  y: number;
}

interface StatusColors {
  fillBg: string;
  stroke: string;
  text: string;
  dotColor: string;
}

const SVG_WIDTH = 680;
const SVG_HEIGHT = 360;

const CENTER_X = SVG_WIDTH / 2;
const CENTER_Y = SVG_HEIGHT / 2;
const MEMBER_CARD_W = 132;
const MEMBER_CARD_H = 58;
const MEMBER_CARD_RX = 12;
const JUDGE_CARD_W = 108;
const JUDGE_CARD_H = 78;
const JUDGE_CARD_RX = 16;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): NodePos {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  const prev = ref.current;
  ref.current = value;
  return prev;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

/** Compute the point on a rect's border (of width w × height h) in the direction toward `target`. */
function rectEdgePoint(center: NodePos, target: NodePos, w: number, h: number): NodePos {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) return { x: center.x + w / 2, y: center.y };
  const hw = w / 2;
  const hh = h / 2;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDx * hh >= absDy * hw) {
    // hits left or right edge
    const t = hw / absDx;
    return { x: center.x + hw * Math.sign(dx), y: center.y + dy * t };
  } else {
    // hits top or bottom edge
    const t = hh / absDy;
    return { x: center.x + dx * t, y: center.y + hh * Math.sign(dy) };
  }
}

function statusStyle(status: MemberNodeStatus): StatusColors {
  switch (status) {
    case 'done':
      return {
        fillBg: 'rgba(216,231,120,0.12)',
        stroke: 'var(--mae-accent)',
        text: 'var(--mae-accent)',
        dotColor: 'var(--mae-accent)',
      };
    case 'in_progress':
      return {
        fillBg: 'var(--mae-progress-bg)',
        stroke: 'var(--mae-progress)',
        text: 'var(--mae-progress)',
        dotColor: 'var(--mae-progress)',
      };
    case 'error':
      return {
        fillBg: 'var(--mae-error-bg)',
        stroke: 'var(--mae-error)',
        text: 'var(--mae-error)',
        dotColor: 'var(--mae-error)',
      };
    case 'pending':
    default:
      return {
        fillBg: 'transparent',
        stroke: 'var(--mae-border)',
        text: 'var(--mae-muted)',
        dotColor: 'var(--mae-border)',
      };
  }
}

const LEGEND_ITEMS: { label: string; status: MemberNodeStatus }[] = [
  { label: 'Done', status: 'done' },
  { label: 'In progress', status: 'in_progress' },
  { label: 'Error', status: 'error' },
  { label: 'Pending', status: 'pending' },
];

export function CouncilGraph({
  members,
  judgeModel,
  judgeStatus,
  judgeSystemPrompt,
  onClick: _onClick,
  onEditMember: _onEditMember,
  idle = true,
  placeholderCount = 0,
}: CouncilGraphProps) {
  const totalSlots = members.length + placeholderCount;
  const memberAngleStep = totalSlots > 0 ? 360 / totalSlots : 0;
  const memberStartAngle = totalSlots === 2 ? 0 : -90;

  // Scale orbit radius with member count
  const ORBIT_R = useMemo(() => {
    if (totalSlots <= 2) return 140;
    if (totalSlots <= 4) return 135;
    if (totalSlots <= 6) return 150;
    return 165;
  }, [totalSlots]);

  const getMemberPosition = useCallback(
    (index: number): NodePos =>
      polarToCartesian(
        CENTER_X,
        CENTER_Y,
        ORBIT_R,
        memberStartAngle + index * memberAngleStep,
      ),
    [ORBIT_R, memberAngleStep, memberStartAngle],
  );

  const judgeEntranceDelay = 0;
  const memberBaseDelay = 150;
  const memberStagger = 80;

  const prevMembers = usePrevious(members);
  const prevJudgeStatus = usePrevious(judgeStatus);
  const [confirmingMembers, setConfirmingMembers] = useState<Set<string>>(new Set());
  const [shakingMembers, setShakingMembers] = useState<Set<string>>(new Set());
  const [converging, setConverging] = useState(false);
  const [judgeConfirming, setJudgeConfirming] = useState(false);

  // Timer cleanup
  const timeoutIds = useRef<Set<number>>(new Set());
  const scheduleTimeout = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timeoutIds.current.delete(id);
      fn();
    }, ms);
    timeoutIds.current.add(id);
  }, []);
  useEffect(() => {
    return () => {
      timeoutIds.current.forEach(id => clearTimeout(id));
      timeoutIds.current.clear();
    };
  }, []);

  const reducedMotion = usePrefersReducedMotion();

  // ── Node positions (draggable) ──
  const initialPositions = useRef<Map<string, NodePos>>(new Map());

  useEffect(() => {
    const map = new Map<string, NodePos>();
    members.forEach((m, i) => {
      map.set(m.id, getMemberPosition(i));
    });
    const newMap = new Map<string, NodePos>();
    members.forEach(m => {
      newMap.set(m.id, initialPositions.current.get(m.id) ?? map.get(m.id)!);
    });
    initialPositions.current = newMap;
    setNodePositions(new Map(newMap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.length, ORBIT_R]);

  const [nodePositions, setNodePositions] = useState<Map<string, NodePos>>(() => {
    const map = new Map<string, NodePos>();
    members.forEach((m, i) => {
      map.set(m.id, getMemberPosition(i));
    });
    return map;
  });

  // Judge position as state (fixes bug: judge was undraggable)
  const [judgePos, setJudgePos] = useState<NodePos>({ x: CENTER_X, y: CENTER_Y });

  // ── Static widescreen viewBox ──
  const viewBox = `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`;

  // ── Drag state ──
  const dragRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const dragStartPosRef = useRef<NodePos | null>(null);
  const wasDraggedRef = useRef(false);

  // ── Pan state ──
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0, isPanning: false, startX: 0, startY: 0 });

  const svgRef = useRef<SVGSVGElement>(null);

  const getSVGPoint = useCallback((clientX: number, clientY: number): NodePos => {
    const svg = svgRef.current;
    if (!svg) return { x: clientX, y: clientY };
    const rect = svg.getBoundingClientRect();
    const vb = svg.getAttribute('viewBox');
    let vbW = SVG_WIDTH;
    let vbH = SVG_HEIGHT;
    if (vb) {
      const parts = vb.split(/\s+/).map(Number);
      if (parts.length === 4) { vbW = parts[2]; vbH = parts[3]; }
    }
    const scaleX = vbW / rect.width;
    const scaleY = vbH / rect.height;
    return {
      x: (clientX - rect.left) * scaleX - panRef.current.x,
      y: (clientY - rect.top) * scaleY - panRef.current.y,
    };
  }, []);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const pt = getSVGPoint(e.clientX, e.clientY);
    if (nodeId === '__judge__') {
      dragStartPosRef.current = judgePos;
    } else {
      const pos = nodePositions.get(nodeId);
      if (!pos) return;
      dragStartPosRef.current = pos;
    }
    wasDraggedRef.current = false;
    dragRef.current = { nodeId, offsetX: pt.x - dragStartPosRef.current.x, offsetY: pt.y - dragStartPosRef.current.y };
  }, [getSVGPoint, nodePositions, judgePos]);

  const handleBgMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).tagName !== 'svg' && !(e.target as Element).classList.contains('graph-bg')) return;
    panRef.current = { x: panRef.current.x, y: panRef.current.y, isPanning: true, startX: e.clientX, startY: e.clientY };
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const pt = getSVGPoint(e.clientX, e.clientY);
        const { nodeId, offsetX, offsetY } = dragRef.current;
        const newX = pt.x - offsetX;
        const newY = pt.y - offsetY;

        // Track whether significant drag occurred
        if (dragStartPosRef.current) {
          const dist = Math.sqrt(
            (newX - dragStartPosRef.current.x) ** 2 +
            (newY - dragStartPosRef.current.y) ** 2
          );
          if (dist > 4) wasDraggedRef.current = true;
        }

        if (nodeId === '__judge__') {
          setJudgePos({ x: newX, y: newY });
        } else {
          setNodePositions(prev => {
            const next = new Map(prev);
            next.set(nodeId, { x: newX, y: newY });
            return next;
          });
        }
        return;
      }
      if (panRef.current.isPanning) {
        const dx = e.clientX - panRef.current.startX;
        const dy = e.clientY - panRef.current.startY;
        const svg = svgRef.current;
        if (svg) {
          const rect = svg.getBoundingClientRect();
          const vb = svg.getAttribute('viewBox');
          let vbW = SVG_WIDTH;
          let vbH = SVG_HEIGHT;
          if (vb) {
            const parts = vb.split(/\s+/).map(Number);
            if (parts.length === 4) { vbW = parts[2]; vbH = parts[3]; }
          }
          const scaleX = vbW / rect.width;
          const scaleY = vbH / rect.height;
          panRef.current.x += dx * scaleX;
          panRef.current.y += dy * scaleY;
          setPan({ x: panRef.current.x, y: panRef.current.y });
        }
        panRef.current.startX = e.clientX;
        panRef.current.startY = e.clientY;
      }
    };
    const handleMouseUp = () => { dragRef.current = null; dragStartPosRef.current = null; panRef.current.isPanning = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [getSVGPoint]);

  // Touch support
  const handleNodeTouchStart = useCallback((e: React.TouchEvent, nodeId: string) => {
    const touch = e.touches[0];
    const pt = getSVGPoint(touch.clientX, touch.clientY);
    if (nodeId === '__judge__') {
      dragStartPosRef.current = judgePos;
    } else {
      const pos = nodePositions.get(nodeId);
      if (!pos) return;
      dragStartPosRef.current = pos;
    }
    wasDraggedRef.current = false;
    dragRef.current = { nodeId, offsetX: pt.x - dragStartPosRef.current.x, offsetY: pt.y - dragStartPosRef.current.y };
  }, [getSVGPoint, nodePositions, judgePos]);

  useEffect(() => {
    const handleTouchMove = (e: TouchEvent) => {
      if (!dragRef.current) return;
      const touch = e.touches[0];
      const pt = getSVGPoint(touch.clientX, touch.clientY);
      const { nodeId, offsetX, offsetY } = dragRef.current;
      const newX = pt.x - offsetX;
      const newY = pt.y - offsetY;

      if (dragStartPosRef.current) {
        const dist = Math.sqrt(
          (newX - dragStartPosRef.current.x) ** 2 +
          (newY - dragStartPosRef.current.y) ** 2
        );
        if (dist > 4) wasDraggedRef.current = true;
      }

      if (nodeId === '__judge__') {
        setJudgePos({ x: newX, y: newY });
      } else {
        setNodePositions(prev => {
          const next = new Map(prev);
          next.set(nodeId, { x: newX, y: newY });
          return next;
        });
      }
    };
    const handleTouchEnd = () => { dragRef.current = null; dragStartPosRef.current = null; };
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);
    return () => { window.removeEventListener('touchmove', handleTouchMove); window.removeEventListener('touchend', handleTouchEnd); };
  }, [getSVGPoint]);

  // State transitions
  useEffect(() => {
    if (!prevMembers) return;
    const newConfirm = new Set<string>();
    const newShake = new Set<string>();
    members.forEach(m => {
      const prev = prevMembers.find(p => p.id === m.id);
      if (!prev || prev.status === m.status) return;
      if (m.status === 'done') newConfirm.add(m.id);
      if (m.status === 'error') newShake.add(m.id);
    });
    if (newConfirm.size > 0) {
      setConfirmingMembers(s => new Set([...s, ...newConfirm]));
      scheduleTimeout(() => {
        setConfirmingMembers(s => { const n = new Set(s); newConfirm.forEach(k => n.delete(k)); return n; });
      }, 300);
    }
    if (newShake.size > 0) {
      setShakingMembers(s => new Set([...s, ...newShake]));
      scheduleTimeout(() => {
        setShakingMembers(s => { const n = new Set(s); newShake.forEach(k => n.delete(k)); return n; });
      }, 300);
    }
  }, [members, prevMembers, scheduleTimeout]);

  useEffect(() => {
    if (prevJudgeStatus !== 'judging' && judgeStatus === 'judging') {
      setConverging(true);
      scheduleTimeout(() => setConverging(false), 800);
    }
    if (prevJudgeStatus !== 'done' && judgeStatus === 'done') {
      setJudgeConfirming(true);
      scheduleTimeout(() => setJudgeConfirming(false), 500);
    }
  }, [judgeStatus, prevJudgeStatus, scheduleTimeout]);

  // Tooltip
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string; title: string } | null>(null);
  const showTooltipAt = (e: React.MouseEvent | React.FocusEvent, text: string | undefined, title: string) => {
    if (!text) return;
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    setTooltip({ x: rect.right, y: rect.top, text, title });
  };
  const handleNodeLeave = () => setTooltip(null);

  // Colors
  const borderColor = 'var(--mae-border)';
  const mutedColor = 'var(--mae-muted)';
  const textColor = 'var(--mae-text)';
  const accentColor = 'var(--mae-accent)';
  const bubbleAssistant = 'var(--mae-bubble-assistant)';

  const judgeFill = judgeStatus === 'done' ? bubbleAssistant : 'var(--mae-surface)';
  const judgeStroke = judgeStatus === 'judging' || judgeStatus === 'done'
    ? accentColor : judgeStatus === 'error' ? 'var(--mae-error)' : borderColor;

  // ── Click handler with drag guard ──
  const handleSvgClick = useCallback(() => {
    if (!wasDraggedRef.current) {
      _onClick?.();
    }
  }, [_onClick]);

  const statusLabel = (status: MemberNodeStatus, error?: string) => {
    switch (status) {
      case 'done': return 'Complete';
      case 'in_progress': return 'In progress';
      case 'error': return error ? error.slice(0, 18) : 'Error';
      case 'pending': return 'Pending';
    }
  };

  return (
    <div className="relative w-full select-none overflow-hidden" style={{ cursor: dragRef.current ? 'grabbing' : 'default' }}>
      <div className="w-full max-w-[680px] mx-auto" style={{ aspectRatio: `${SVG_WIDTH} / ${SVG_HEIGHT}` }}>
      <svg
        ref={svgRef}
        viewBox={viewBox}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
        role="img"
        aria-label={`Council graph: judge ${judgeModel} with ${members.length} members`}
        onMouseDown={handleBgMouseDown}
        onClick={handleSvgClick}
      >
        <defs>
          {/* Radial background gradient */}
          <radialGradient id="bg-gradient" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="var(--mae-surface, #161616)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--mae-bg, #0d0d0d)" stopOpacity="0.9" />
          </radialGradient>
        </defs>

        {/* Background */}
        <rect
          className="graph-bg"
          x="0"
          y="0"
          width={SVG_WIDTH}
          height={SVG_HEIGHT}
          fill="url(#bg-gradient)"
          rx="16"
        />

        {/* Pan group */}
        <g transform={`translate(${pan.x}, ${pan.y})`}>

          {/* ── Orbit ring (static dashed circle at member orbit radius) ── */}
          <circle
            cx={judgePos.x}
            cy={judgePos.y}
            r={ORBIT_R}
            fill="none"
            stroke="var(--mae-border)"
            strokeWidth={1}
            strokeDasharray="5 7"
            opacity={0.35}
          />

          {/* ── Connectors (straight spokes, edge-to-edge) ── */}
          {members.map((m, i) => {
            const pos = nodePositions.get(m.id) ?? getMemberPosition(i);
            const jPos = judgePos;
            const isActive = m.status === 'in_progress' && !idle;

            const fromEdge = rectEdgePoint(pos, jPos, MEMBER_CARD_W, MEMBER_CARD_H);
            const toEdge = rectEdgePoint(jPos, pos, JUDGE_CARD_W, JUDGE_CARD_H);

            return (
              <g key={`conn-${m.id}`}>
                {/* Active connector: animated dash in progress color */}
                {isActive ? (
                  <line
                    x1={fromEdge.x}
                    y1={fromEdge.y}
                    x2={toEdge.x}
                    y2={toEdge.y}
                    stroke="var(--mae-progress)"
                    strokeWidth={2}
                    className={reducedMotion ? undefined : 'graph-dash-progress'}
                  />
                ) : (
                  <line
                    x1={fromEdge.x}
                    y1={fromEdge.y}
                    x2={toEdge.x}
                    y2={toEdge.y}
                    stroke={borderColor}
                    strokeWidth={1}
                    strokeDasharray="4 5"
                    opacity={converging ? 0.1 : 0.35}
                  />
                )}
                {/* Converge pulse */}
                {converging && (
                  <line
                    x1={fromEdge.x}
                    y1={fromEdge.y}
                    x2={toEdge.x}
                    y2={toEdge.y}
                    stroke={accentColor}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    opacity={0.7}
                    className="graph-converge"
                  />
                )}
              </g>
            );
          })}

          {/* ── Member nodes (rounded-rect cards) ── */}
          {members.map((m, i) => {
            const pos = nodePositions.get(m.id) ?? getMemberPosition(i);
            const isActive = m.status === 'in_progress' && !idle;
            const isDone = m.status === 'done';
            const isConfirm = confirmingMembers.has(m.id);
            const isShake = shakingMembers.has(m.id);
            const hasPrompt = !!m.systemPrompt;
            const delayMs = memberBaseDelay + i * memberStagger;
            const animClass = isShake ? 'graph-shake' : isConfirm ? 'graph-confirm-bump' : '';
            const ariaLabel = `${m.model}${hasPrompt ? ', has system prompt' : ''}`;
            const colors = statusStyle(m.status);

            const modelName = m.model.includes('/')
              ? m.model.split('/').pop()!
              : m.model;

            const displayedModel =
              modelName.length > 16
                ? `${modelName.slice(0, 14)}…`
                : modelName;

            return (
              <g
                key={`node-${m.id}`}
                className={`graph-entrance-member ${animClass}`}
                style={{ animationDelay: reducedMotion ? undefined : `${delayMs}ms`, cursor: 'grab' }}
                onMouseDown={e => handleNodeMouseDown(e, m.id)}
                onTouchStart={e => handleNodeTouchStart(e, m.id)}
                onDoubleClick={() => _onEditMember?.(m.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    _onEditMember?.(m.id);
                  }
                }}
                onMouseEnter={e => showTooltipAt(e, m.systemPrompt, m.model)}
                onMouseLeave={handleNodeLeave}
                onFocus={e => showTooltipAt(e, m.systemPrompt, m.model)}
                onBlur={handleNodeLeave}
                tabIndex={0}
                role="button"
                aria-label={ariaLabel}
              >
                {/* Card background */}
                <rect
                  x={pos.x - MEMBER_CARD_W / 2}
                  y={pos.y - MEMBER_CARD_H / 2}
                  width={MEMBER_CARD_W}
                  height={MEMBER_CARD_H}
                  rx={MEMBER_CARD_RX}
                  fill={colors.fillBg}
                  stroke={isDone ? colors.stroke : isActive ? colors.stroke : colors.stroke}
                  strokeWidth={isActive ? 2 : isDone ? 1.5 : 1}
                />
                {/* System prompt indicator dot */}
                {hasPrompt && (
                  <circle
                    cx={pos.x + MEMBER_CARD_W / 2 - 8}
                    cy={pos.y - MEMBER_CARD_H / 2 + 8}
                    r={3}
                    fill={accentColor}
                    stroke="var(--mae-bg, #0d0d0d)"
                    strokeWidth={1}
                  />
                )}
                {/* Model name (title line) — strip provider prefix for readability */}
                <text
                  x={pos.x}
                  y={pos.y - 7}
                  textAnchor="middle"
                  fill={colors.text}
                  fontSize="12"
                  fontWeight="500"
                  fontFamily="system-ui, sans-serif"
                >
                  {displayedModel}
                </text>
                {/* Status (subtitle line) */}
                <text
                  x={pos.x}
                  y={pos.y + 14}
                  textAnchor="middle"
                  fill={isActive || isDone ? mutedColor : mutedColor}
                  fontSize="11"
                  fontFamily="Maitree, system-ui, sans-serif"
                  opacity={0.8}
                >
                  {statusLabel(m.status, m.error)}
                </text>
              </g>
            );
          })}

          {/* ── Placeholder nodes ── */}
          {Array.from({ length: placeholderCount }).map((_, i) => {
            const memberIndex = members.length + i;
            const pos = getMemberPosition(memberIndex);
            const delayMs = memberBaseDelay + memberIndex * memberStagger;
            return (
              <g key={`placeholder-${i}`} className="graph-entrance-member" style={{ animationDelay: reducedMotion ? undefined : `${delayMs}ms` }}>
                <rect
                  x={pos.x - MEMBER_CARD_W / 2}
                  y={pos.y - MEMBER_CARD_H / 2}
                  width={MEMBER_CARD_W}
                  height={MEMBER_CARD_H}
                  rx={MEMBER_CARD_RX}
                  fill="transparent"
                  stroke={borderColor}
                  strokeWidth={1}
                  strokeDasharray="5 5"
                  opacity={0.3}
                />
              </g>
            );
          })}

          {/* ── Judge node ── */}
          <g
            className={`graph-entrance-judge ${judgeConfirming ? 'graph-confirm-bump-large' : ''}`}
            style={{
              animationDelay: reducedMotion ? undefined : `${judgeEntranceDelay}ms`,
              transformOrigin: `${judgePos.x}px ${judgePos.y}px`,
              cursor: 'grab',
            }}
            onMouseDown={e => handleNodeMouseDown(e, '__judge__')}
            onTouchStart={e => handleNodeTouchStart(e, '__judge__')}
            onMouseEnter={e => showTooltipAt(e, judgeSystemPrompt, 'Judge')}
            onMouseLeave={handleNodeLeave}
            onFocus={e => showTooltipAt(e, judgeSystemPrompt, 'Judge')}
            onBlur={handleNodeLeave}
            aria-label={`Judge node: ${judgeModel}${judgeSystemPrompt ? ', has system prompt' : ''}`}
          >
            {/* Pulsing outer ring when judging */}
            {judgeStatus === 'judging' && !idle && (
              <circle
                cx={judgePos.x}
                cy={judgePos.y}
                r={JUDGE_CARD_W / 2 + 14}
                fill="none"
                stroke={accentColor}
                strokeWidth={1}
                opacity={0.2}
                className="graph-pulse-accent"
              />
            )}
            {/* Main judge rect card */}
            <rect
              x={judgePos.x - JUDGE_CARD_W / 2}
              y={judgePos.y - JUDGE_CARD_H / 2}
              width={JUDGE_CARD_W}
              height={JUDGE_CARD_H}
              rx={JUDGE_CARD_RX}
              fill={judgeFill}
              stroke={judgeStroke}
              strokeWidth={judgeStatus === 'judging' ? 2.5 : 1.5}
            />
            {/* System prompt badge */}
            {judgeSystemPrompt && (
              <circle
                cx={judgePos.x + JUDGE_CARD_W / 2 - 8}
                cy={judgePos.y - JUDGE_CARD_H / 2 + 8}
                r={3}
                fill={accentColor}
                stroke="var(--mae-bg, #0d0d0d)"
                strokeWidth={1.5}
              />
            )}
            {/* Judge label */}
            <text
              x={judgePos.x}
              y={judgePos.y - 10}
              textAnchor="middle"
              dominantBaseline="central"
              fill={textColor}
              fontSize="13"
              fontFamily="Maitree, system-ui, sans-serif"
              fontWeight="600"
            >
              {judgeStatus === 'judging' && !idle ? 'Synthesizing…' : 'Judge'}
            </text>
            {/* Judge model name */}
            <text
              x={judgePos.x}
              y={judgePos.y + 16}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--mae-muted)"
              fontSize="10"
              fontFamily="Maitree, system-ui, sans-serif"
            >
                {(judgeModel.includes('/') ? judgeModel.split('/').pop()! : judgeModel).length > 18
                  ? (judgeModel.includes('/') ? judgeModel.split('/').pop()! : judgeModel).slice(0, 16) + '…'
                  : judgeModel.includes('/') ? judgeModel.split('/').pop()! : judgeModel}
            </text>
          </g>
        </g>
      </svg>
      </div>

      {/* ── Status Legend ── */}
      <div className="flex justify-center gap-5 mt-3 text-[12px]" style={{ color: mutedColor }}>
        {LEGEND_ITEMS.map(item => {
          const s = statusStyle(item.status);
          return (
            <div key={item.label} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.dotColor }} />
              <span>{item.label}</span>
            </div>
          );
        })}
      </div>

      {tooltip && (
        <div className="fixed z-50 pointer-events-none" style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}>
          <NodeTooltip text={tooltip.text} title={tooltip.title} />
        </div>
      )}
    </div>
  );
}