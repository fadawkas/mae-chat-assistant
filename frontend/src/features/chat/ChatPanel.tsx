import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamChat } from '../../api/sse';
import { fetchConversation } from '../../api/conversations';
import type { ChatMessage } from '../../types';
import { MaeLogo } from '../../components/common/MaeLogo';
import { markdownComponents } from '../../components/common/CodeBlock';
import { useModels } from '../../hooks/useModels';

type Status =
  | { type: 'idle' }
  | { type: 'streaming' }
  | { type: 'error'; message: string };

interface ChatPanelProps {
  conversationId: string;
  model: string;
  onModelChange: (m: string) => void;
  onTitleChange?: () => void;
}

/** Models one displayed turn — a user message followed by the assistant reply. */
interface Turn {
  user: string;
  assistant: string;
}


/** Inline model selector pill — opens a dropdown upward above the input bar */
function ModelSelector({ model, onModelChange }: { model: string; onModelChange: (m: string) => void }) {
  const models = useModels();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filteredModels = models
    .map((m) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return { model: m, score: 0 };
      const haystack = `${m.name} ${m.id}`.toLowerCase();
      if (haystack.startsWith(needle)) return { model: m, score: 1 };
      if (haystack.includes(needle)) return { model: m, score: 2 };
      let position = 0;
      for (const character of needle) {
        position = haystack.indexOf(character, position);
        if (position === -1) return { model: m, score: 99 };
        position += 1;
      }
      return { model: m, score: 3 };
    })
    .filter(({ score }) => score < 99)
    .sort((a, b) => a.score - b.score || a.model.name.localeCompare(b.model.name));

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  const selectModel = (id: string) => {
    onModelChange(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setQuery(''); }}
        className="flex items-center gap-1.5 text-sidebar-meta text-mae-muted hover:text-mae-text transition-colors cursor-pointer px-2 py-1 rounded-[6px] hover:bg-mae-bubble-assistant focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-1 border-none bg-transparent"
      >
        <span>{model.replace(/^.*\//, '')}</span>
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 12 12" fill="none">
          <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full mb-1.5 left-0 w-[min(320px,calc(100vw-3rem))] max-h-[min(60vh,26rem)] overflow-hidden bg-mae-surface border border-mae-border rounded-[10px] shadow-lg z-50">
          <div className="border-b border-mae-border p-2">
            <input
              ref={searchRef}
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') setOpen(false);
                if (event.key === 'ArrowDown' && filteredModels.length) { event.preventDefault(); setHighlighted(value => Math.min(value + 1, filteredModels.length - 1)); }
                if (event.key === 'ArrowUp' && filteredModels.length) { event.preventDefault(); setHighlighted(value => Math.max(value - 1, 0)); }
                if (event.key === 'Enter' && filteredModels[highlighted]) { event.preventDefault(); selectModel(filteredModels[highlighted].model.id); }
              }}
              placeholder="Search models..."
              aria-label="Search models"
              className="w-full rounded-md border border-mae-border bg-mae-bg px-2.5 py-2 text-sm text-mae-text outline-none placeholder:text-mae-muted focus:border-mae-accent"
            />
          </div>
          <div className="max-h-[calc(min(60vh,26rem)-4.25rem)] overflow-y-auto overscroll-contain py-1">
          {filteredModels.length === 0 && <p className="px-3 py-5 text-center text-sm text-mae-muted">No matching models</p>}
          {filteredModels.map(({ model: m }, index) => {
            const isSelected = m.id === model;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => selectModel(m.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sidebar-title text-left transition-colors hover:bg-mae-bubble-assistant focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-[-2px] ${
                  index === highlighted ? 'bg-mae-bubble-assistant' : ''
                } ${
                  isSelected ? 'text-mae-text' : 'text-mae-muted'
                }`}
              >
                {isSelected && (
                  <span className="w-[6px] h-[6px] rounded-full bg-mae-accent shrink-0" />
                )}
                {!isSelected && (
                  <span className="w-[6px] h-[6px] shrink-0" />
                )}
                <div className="flex flex-col">
                   <span>{m.name}</span>
                   <span className="text-sidebar-meta text-mae-muted">{m.id}</span>
                </div>
              </button>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
}

export function ChatPanel({ conversationId, model, onModelChange, onTitleChange }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<Status>({ type: 'idle' });

  const inputRef = useRef('');
  inputRef.current = input;
  const statusRef = useRef(status);
  statusRef.current = status;
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when new tokens arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  // Fetch conversation history when conversationId changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus({ type: 'idle' });
      try {
        const detail = await fetchConversation(conversationId);
        if (cancelled) return;
        const loaded: Turn[] = [];
        for (const msg of detail.messages) {
          if (msg.role === 'user') {
            loaded.push({ user: msg.content, assistant: '' });
          } else if (msg.role === 'assistant' && loaded.length > 0) {
            loaded[loaded.length - 1].assistant = msg.content;
          }
        }
        setTurns(loaded);
      } catch {
        if (!cancelled) {
          setTurns([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId]);

  // Build the linear message array from turns + new text.
  const buildMessages = useCallback((newUserText: string): ChatMessage[] => {
    const msgs: ChatMessage[] = [];
    for (const t of turnsRef.current) {
      msgs.push({ role: 'user' as const, content: t.user });
      if (t.assistant) {
        msgs.push({ role: 'assistant' as const, content: t.assistant });
      }
    }
    msgs.push({ role: 'user' as const, content: newUserText });
    return msgs;
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = inputRef.current.trim();
    if (!trimmed || statusRef.current.type === 'streaming') return;

    setTurns((prev) => [...prev, { user: trimmed, assistant: '' }]);
    setInput('');
    setStatus({ type: 'streaming' });

    const gen = streamChat({
      model,
      messages: buildMessages(trimmed),
      conversation_id: conversationId,
    });

    let assistantContent = '';

    try {
      for await (const event of gen) {
        switch (event.type) {
          case 'token':
            assistantContent += event.text;
            setTurns((prev) => {
              const updated = [...prev];
              if (updated.length > 0) {
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  assistant: assistantContent,
                };
              }
              return updated;
            });
            break;
          case 'done':
            setStatus({ type: 'idle' });
            onTitleChange?.();
            break;
          case 'error':
            setStatus({ type: 'error', message: event.message });
            break;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ type: 'error', message: msg });
    }
  }, [model, conversationId, buildMessages, onTitleChange]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const isBusy = status.type === 'streaming';
  const canSend = input.trim().length > 0 && !isBusy;

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      {/* Messages area */}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto scroll-smooth">
        <div className="max-w-[820px] min-w-0 w-full mx-auto px-5 md:px-8 pt-8 pb-40 flex flex-col gap-8">
          {turns.length > 0 ? (
            turns.map((t, i) => (
              <div key={i} className="flex flex-col gap-5 pb-7 border-b border-mae-border/40 last:border-none">
                {/* User message — right-aligned bubble, plain text */}
                <div className="flex flex-col max-w-[70%] md:max-w-[65%] self-end ml-auto">
                  <div className="px-4 py-3 rounded-2xl rounded-br-md bg-mae-bubble-user border border-mae-border text-[15px] leading-6 text-mae-text whitespace-pre-wrap break-words">
                    {t.user}
                  </div>
                </div>
                {/* Assistant message — no bubble, full-width, markdown rendered */}
                {t.assistant && (
                  <div className="flex min-w-0 flex-col animate-[message-in_0.18s_ease-out]">
                    <div className="flex items-center gap-2 mb-3">
                      <MaeLogo size={20} />
                      <span className="text-sm font-medium text-mae-text">Mae</span>
                    </div>
                    <div className="assistant-message min-w-0 border-l border-mae-border pl-5">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {t.assistant}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
                {/* Loading indicator while streaming */}
                {!t.assistant && status.type === 'streaming' && i === turns.length - 1 && (
                  <div className="flex self-start items-center gap-[5px]">
                    <span className="w-2 h-2 rounded-full bg-mae-accent animate-typing-bounce" />
                    <span className="w-2 h-2 rounded-full bg-mae-accent animate-typing-bounce" style={{ animationDelay: '0.2s' }} />
                    <span className="w-2 h-2 rounded-full bg-mae-accent animate-typing-bounce" style={{ animationDelay: '0.4s' }} />
                  </div>
                )}
              </div>
            ))
          ) : status.type === 'error' ? (
            <div className="flex items-start gap-3 px-4 py-3 rounded-[10px] bg-mae-error-bg border border-mae-error text-sidebar-meta text-mae-error">
              <span className="shrink-0 text-base leading-tight">⚠</span>
              <span>{status.message}</span>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center min-h-[300px]">
              <p className="text-chat font-medium text-mae-text">Ask Mae anything</p>
              <p className="text-sidebar-meta text-mae-muted max-w-[240px]">
                Type a message below and press Ctrl+Enter to send.
              </p>
            </div>
          )}

          {/* Error banner at the end if turns exist but error occurred */}
          {turns.length > 0 && status.type === 'error' && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-[10px] bg-mae-error-bg border border-mae-error text-sidebar-meta text-mae-error">
              <span className="shrink-0 text-base leading-tight">⚠</span>
              <span>{status.message}</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input container — glass, unified, with model selector + send */}
      <div className="max-w-chat-col min-w-0 w-full mx-auto px-6 pb-4 shrink-0">
        <div
          ref={inputContainerRef}
            className="flex flex-col rounded-2xl border border-mae-border bg-mae-surface/95 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-colors focus-within:border-mae-accent/70"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (Ctrl+Enter to send)"
            disabled={isBusy}
            rows={2}
            className="w-full resize-none min-h-[56px] max-h-[180px] text-[15px] leading-6 px-4 pt-4 pb-2 bg-transparent text-mae-text placeholder:text-mae-muted/70 outline-none border-none disabled:opacity-50 font-sans"
          />
          {/* Bottom row: model selector left, send button right */}
          <div className="flex items-center justify-between px-3 pb-3">
            <ModelSelector model={model} onModelChange={onModelChange} />
            <button
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
              className="flex items-center justify-center w-8 h-8 rounded-[8px] border-none bg-mae-accent text-mae-accent-on text-sm cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-2 disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:opacity-35"
            >
              <span className="inline-block leading-none">↑</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
