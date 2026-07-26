import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModels } from '../../hooks/useModels';

interface ModelPickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  optional?: boolean;
  placeholder?: string;
}

export function ModelPicker({ value, onChange, disabled = false, optional = false, placeholder = 'Select a model' }: ModelPickerProps) {
  const models = useModels();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [menuStyle, setMenuStyle] = useState({ top: 0, left: 0, width: 240, maxHeight: 320 });

  const filtered = models.map(model => {
    const needle = query.trim().toLowerCase();
    const haystack = `${model.name} ${model.id}`.toLowerCase();
    if (!needle) return { model, score: 0 };
    if (haystack.startsWith(needle)) return { model, score: 1 };
    if (haystack.includes(needle)) return { model, score: 2 };
    let position = 0;
    for (const character of needle) {
      position = haystack.indexOf(character, position);
      if (position === -1) return { model, score: 99 };
      position += 1;
    }
    return { model, score: 3 };
  }).filter(item => item.score < 99).sort((a, b) => a.score - b.score || a.model.name.localeCompare(b.model.name));

  useEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const trigger = ref.current?.getBoundingClientRect();
      if (!trigger) return;
      const gap = 6;
      const viewportPadding = 12;
      const availableBelow = window.innerHeight - trigger.bottom - gap - viewportPadding;
      const availableAbove = trigger.top - gap - viewportPadding;
      const openAbove = availableBelow < 240 && availableAbove > availableBelow;
      const maxHeight = Math.max(160, Math.min(416, openAbove ? availableAbove : availableBelow));
      const width = Math.min(Math.max(trigger.width, 240), window.innerWidth - viewportPadding * 2);
      const left = Math.min(Math.max(trigger.left, viewportPadding), window.innerWidth - width - viewportPadding);
      setMenuStyle({
        top: openAbove ? Math.max(viewportPadding, trigger.top - gap - maxHeight) : trigger.bottom + gap,
        left,
        width,
        maxHeight,
      });
    };

    positionMenu();
    searchRef.current?.focus();
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    document.addEventListener('mousedown', close);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
      document.removeEventListener('mousedown', close);
    };
  }, [open]);

  useEffect(() => setHighlighted(0), [query]);

  const select = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    setQuery('');
  };

  return <div ref={ref} className="relative w-full">
    <button type="button" disabled={disabled} onClick={() => { setOpen(current => !current); setQuery(''); }} className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-mae-border bg-mae-bg px-3 py-2 text-left text-sm text-mae-text transition-colors hover:border-mae-muted focus-visible:outline-2 focus-visible:outline-mae-accent disabled:cursor-not-allowed disabled:opacity-35">
      <span className={value ? 'truncate' : 'truncate text-mae-muted'}>{value ? value.replace(/^.*\//, '') : placeholder}</span>
      <svg className={`h-3.5 w-3.5 shrink-0 text-mae-muted transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && createPortal(<div ref={menuRef} style={{ top: menuStyle.top, left: menuStyle.left, width: menuStyle.width, maxHeight: menuStyle.maxHeight }} className="fixed z-[100] overflow-hidden rounded-[10px] border border-mae-border bg-mae-surface shadow-lg">
      <div className="border-b border-mae-border p-2"><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); if (event.key === 'ArrowDown' && filtered.length) { event.preventDefault(); setHighlighted(index => Math.min(index + 1, filtered.length - 1)); } if (event.key === 'ArrowUp' && filtered.length) { event.preventDefault(); setHighlighted(index => Math.max(index - 1, 0)); } if (event.key === 'Enter' && filtered[highlighted]) { event.preventDefault(); select(filtered[highlighted].model.id); } }} placeholder="Search models..." aria-label="Search models" className="w-full rounded-md border border-mae-border bg-mae-bg px-2.5 py-2 text-sm text-mae-text outline-none placeholder:text-mae-muted focus:border-mae-accent" /></div>
      <div className="max-h-full overflow-y-auto overscroll-contain py-1">
        {optional && <button type="button" onClick={() => select('')} className="w-full border-b border-mae-border px-3 py-2 text-left text-sm text-mae-muted hover:bg-mae-bubble-assistant">No model override</button>}
        {value && !models.some(model => model.id === value) && <button type="button" onClick={() => select(value)} className="w-full border-b border-mae-border px-3 py-2 text-left text-sm text-mae-accent hover:bg-mae-bubble-assistant">Use current: {value}</button>}
        {!filtered.length && !value && <p className="px-3 py-5 text-center text-sm text-mae-muted">No matching models</p>}
        {filtered.map(({ model }, index) => <button type="button" key={model.id} onClick={() => select(model.id)} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-mae-bubble-assistant ${index === highlighted ? 'bg-mae-bubble-assistant' : ''} ${model.id === value ? 'text-mae-text' : 'text-mae-muted'}`}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${model.id === value ? 'bg-mae-accent' : 'bg-transparent'}`} /><span className="min-w-0"><span className="block truncate">{model.name}</span><span className="block truncate text-xs text-mae-muted">{model.id}</span></span></button>)}
      </div>
    </div>, document.body)}
  </div>;
}
