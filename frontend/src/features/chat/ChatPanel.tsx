import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchChatRun, issueBrowserGrant, newChatRunId, stopChatRun, submitChat, type ChatRun } from '../../api/chat';
import { createConversation, fetchConversation } from '../../api/conversations';
import type { DocumentArtifact } from '../../types';
import { MaeLogo } from '../../components/common/MaeLogo';
import { markdownComponents } from '../../components/common/CodeBlock';
import { useChatSpeech } from './useChatSpeech';

const promptStarters = [
  { label: 'Draft a summary', prompt: 'Help me summarize the following notes:\n\n', icon: 'M5 5h14M5 10h14M5 15h14M5 20h8' },
  { label: 'Run a calculation', prompt: 'Help me calculate ', icon: 'M4 7h6M7 4v6m7-3h6M5 15l4 4m0-4-4 4m9-3h6m-6 4h6' },
  { label: 'Create a document', prompt: 'Create a document about ', icon: 'M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9m-6-6 6 6m-6-6v6h6M9 13h6m-6 4h4' },
];

type Status =
  | { type: 'idle' }
  | { type: 'streaming'; message?: string }
  | { type: 'error'; message: string };

interface ChatPanelProps {
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
  onTitleChange?: () => void;
  onArtifactCreated: () => void;
}

/** Models one displayed turn — a user message followed by the assistant reply. */
interface Turn {
  id: string;
  user: string;
  assistant: string;
  complete?: boolean;
  artifacts?: DocumentArtifact[];
}

export function ChatPanel({ conversationId, onConversationCreated, onTitleChange, onArtifactCreated }: ChatPanelProps) {
  const [initialId] = useState(conversationId);
  const savedId = useRef(initialId);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [input, setInput] = useState('');
  const speech = useChatSpeech(text => setInput(draft =>
    (draft + (draft && !/\s$/.test(draft) ? ' ' : '') + text).slice(0, 100_000)));
  const [turns, setTurns] = useState<Turn[]>([]);
  const [historyLoading, setHistoryLoading] = useState(Boolean(initialId));
  const [status, setStatus] = useState<Status>({ type: 'idle' });

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef('');
  inputRef.current = input;
  const statusRef = useRef(status);
  statusRef.current = status;
  const [runId, setRunId] = useState<string>();
  const pending = useRef<{ id: string; content: string; browser: boolean }>();
  const [useBrowserTab, setUseBrowserTab] = useState(false);
  const [browserState, setBrowserState] = useState<ChatRun['browser_state']>(null);
  const [browserGrant, setBrowserGrant] = useState('');
  const [grantError, setGrantError] = useState('');
  const [issuingGrant, setIssuingGrant] = useState(false);
  const artifactNames = useRef(new Set<string>());

  const transcript = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  useLayoutEffect(() => {
    const area = transcript.current;
    if (area && followLatest.current) area.scrollTop = area.scrollHeight;
  }, [turns, status]);

  const applySnapshot = useCallback((run: ChatRun) => {
    const area = transcript.current;
    if (area) followLatest.current = area.scrollHeight - area.scrollTop - area.clientHeight < 96;
    const turn = { id: run.user_message_id, user: run.user_content, assistant: run.content, complete: run.status === 'done', artifacts: run.artifacts };
    setTurns(previous => previous.some(item => item.id === turn.id)
      ? previous.map(item => item.id === turn.id ? turn : item)
      : [...previous, turn]);
    setBrowserState(run.browser_state);
    if (run.browser_state !== 'waiting') setBrowserGrant('');
    const newArtifacts = run.artifacts.filter(file => !artifactNames.current.has(file.filename));
    if (newArtifacts.length) {
      newArtifacts.forEach(file => artifactNames.current.add(file.filename));
      onArtifactCreated();
    }
    if (run.status === 'queued' || run.status === 'in_progress') {
      setStatus({ type: 'streaming', message: run.progress ?? (run.status === 'queued' ? 'Queued…' : 'Working…') });
      return true;
    }
    setStatus(run.error ? { type: 'error', message: run.error } : { type: 'idle' });
    return false;
  }, [onArtifactCreated]);

  // A different selected conversation mounts a new panel. A newly saved draft does not.
  useEffect(() => {
    if (!initialId) return;
    const controller = new AbortController();
    (async () => {
      try {
        const detail = await fetchConversation(initialId);
        if (controller.signal.aborted) return;
        const loaded: Turn[] = [];
        for (const msg of detail.messages) {
          if (msg.role === 'user') loaded.push({ id: msg.id, user: msg.content, assistant: '' });
          else if (msg.role === 'assistant' && loaded.length) {
            loaded[loaded.length - 1].assistant = msg.content;
            loaded[loaded.length - 1].complete = Boolean(msg.content) && (!msg.run_status || msg.run_status === 'done');
            loaded[loaded.length - 1].artifacts = msg.artifacts;
            msg.artifacts?.forEach(file => artifactNames.current.add(file.filename));
          }
        }
        setTurns(loaded);
        const run = await fetchChatRun(initialId, undefined, controller.signal);
        if (!controller.signal.aborted && run && applySnapshot(run)) setRunId(run.id);
      } catch {
        if (!controller.signal.aborted) setStatus({ type: 'error', message: 'Could not restore this conversation. Reopen it to retry.' });
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    })();
    return () => controller.abort();
  }, [initialId, applySnapshot]);

  useEffect(() => {
    const id = savedId.current;
    if (!runId || !id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const run = await fetchChatRun(id, runId, controller.signal);
        if (controller.signal.aborted) return;
        if (!run || !applySnapshot(run)) {
          if (!run) setStatus({ type: 'error', message: 'Chat run no longer exists.' });
          setRunId(undefined);
          onTitleChange?.();
          return;
        }
      } catch {
        if (controller.signal.aborted) return;
        setStatus({ type: 'streaming', message: 'Connection lost. Reconnecting to the run…' });
      }
      timer = setTimeout(poll, 700);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [runId, applySnapshot, onTitleChange]);

  const handleSend = useCallback(async () => {
    const trimmed = inputRef.current.trim();
    if (!trimmed || historyLoading || speech.listening || statusRef.current.type === 'streaming') return;
    statusRef.current = { type: 'streaming', message: 'Starting…' };
    setStatus(statusRef.current);
    try {
      if (!savedId.current) {
        const conversation = await createConversation();
        if (!mounted.current) { onTitleChange?.(); return; }
        savedId.current = conversation.id;
        onConversationCreated(conversation.id);
      }
      if (pending.current?.content !== trimmed || pending.current.browser !== useBrowserTab) {
        pending.current = { id: newChatRunId(), content: trimmed, browser: useBrowserTab };
      }
      const accepted = pending.current.id;
      await submitChat(savedId.current, accepted, trimmed, useBrowserTab);
      if (!mounted.current) return;
      followLatest.current = true;
      pending.current = undefined;
      setInput('');
      setUseBrowserTab(false);
      setGrantError('');
      setStopError('');
      setRunId(accepted);
      onTitleChange?.();
    } catch (error) {
      if (mounted.current) setStatus({
        type: 'error', message: error instanceof Error ? error.message : 'Could not start a chat run.',
      });
    }
  }, [historyLoading, onConversationCreated, onTitleChange, speech.listening, useBrowserTab]);

  const handleGrant = async () => {
    if (!runId || issuingGrant) return;
    setGrantError('');
    setIssuingGrant(true);
    try {
      setBrowserGrant((await issueBrowserGrant(runId)).code);
    } catch (error) {
      setGrantError(error instanceof Error ? error.message : 'Could not issue a browser grant.');
    } finally {
      setIssuingGrant(false);
    }
  };

  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState('');
  const handleStop = async () => {
    if (!runId || stopping) return;
    setStopping(true);
    setStopError('');
    try {
      await stopChatRun(runId);
    } catch (error) {
      setStopError(error instanceof Error ? error.message : 'Could not stop the run.');
    } finally {
      setStopping(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const isBusy = status.type === 'streaming';
  const canSend = input.trim().length > 0 && !isBusy && !historyLoading && !speech.listening;
  const isEmpty = !historyLoading && !turns.length;
  const showStarters = isEmpty && status.type === 'idle' && !input && !speech.listening;

  return (
    <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${isEmpty ? 'overflow-y-auto pt-[clamp(2.5rem,calc(34dvh-8rem),9rem)] md:pt-[clamp(4rem,28dvh,17rem)]' : ''}`}>
      {/* Messages area */}
      <div ref={transcript} className={`min-h-0 min-w-0 ${isEmpty ? 'shrink-0' : 'flex-1 overflow-y-auto'}`}>
        <div className={`mx-auto flex w-full min-w-0 max-w-chat-col flex-col gap-8 px-4 sm:px-6 ${isEmpty ? 'pb-6' : 'py-6 sm:pt-10'}`}>
          {turns.length > 0 ? (
            turns.map((t, i) => (
              <div key={t.id} className="flex flex-col gap-5">
                {/* User message — right-aligned bubble, plain text */}
                <div className="flex flex-col max-w-[85%] sm:max-w-[75%] self-end ml-auto">
                  <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-mae-bubble-user px-4 py-3 text-chat text-mae-text">
                    {t.user}
                  </div>
                </div>
                {/* Assistant message — no bubble, full-width, markdown rendered */}
                {t.assistant && (
                  <div className="flex min-w-0 flex-col">
                    <div className="flex items-center gap-2 mb-3">
                      <MaeLogo size={24} />
                      <span className="text-base font-semibold text-mae-text">Mae</span>
                    </div>
                    <div className="assistant-message min-w-0 break-words text-chat">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {t.assistant}
                      </ReactMarkdown>
                    </div>
                    {t.complete && speech.canSpeak && (
                      <button type="button" onClick={() => speech.read(t.id, t.assistant)} disabled={speech.listening}
                        className="mt-2 min-h-10 self-start rounded-lg px-2 text-sm text-mae-muted hover:bg-mae-bubble-assistant disabled:opacity-50">
                        {speech.reading === t.id ? 'Stop reading' : 'Read aloud'}
                      </button>
                    )}
                  </div>
                )}
                {!!t.artifacts?.length && (
                  <ul aria-label="Generated files" className="flex flex-wrap gap-2">
                    {t.artifacts.map(file => (
                      <li key={file.filename} className="min-w-0 max-w-full">
                        {['image/png', 'image/jpeg', 'image/webp'].includes(file.content_type) && (
                          <img
                            src={`${file.download_url}?inline=true`}
                            alt={file.display_name}
                            loading="lazy"
                            className="mb-2 max-h-[65vh] max-w-full rounded-lg border border-mae-border object-contain"
                          />
                        )}
                        <a href={file.download_url} download={file.download_name ?? true} className="block break-words rounded-lg border border-mae-border bg-mae-surface px-3 py-2 text-sm text-mae-accent hover:underline">
                          Download {file.display_name}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {status.type === 'streaming' && status.message && i === turns.length - 1 && (
                  <p role="status" className="text-sm text-mae-muted">{status.message}</p>
                )}
                {!t.assistant && status.type === 'streaming' && !status.message && i === turns.length - 1 && (
                  <div className="flex self-start items-center gap-[5px]">
                    <span className="w-2 h-2 rounded-full bg-mae-accent animate-typing-bounce" />
                    <span className="w-2 h-2 rounded-full bg-mae-accent animate-typing-bounce" style={{ animationDelay: '0.2s' }} />
                    <span className="w-2 h-2 rounded-full bg-mae-accent animate-typing-bounce" style={{ animationDelay: '0.4s' }} />
                  </div>
                )}
              </div>
            ))
          ) : historyLoading ? (
            <p role="status" className="text-center text-sm text-mae-muted">Loading conversation…</p>
          ) : status.type === 'error' ? (
            <div className="flex items-start gap-3 px-4 py-3 rounded-[10px] bg-mae-error-bg border border-mae-error text-sidebar-meta text-mae-error">
              <span className="shrink-0 text-base leading-tight">⚠</span>
              <span>{status.message}</span>
            </div>
          ) : (
            <h1 className="text-balance text-center text-[2.5rem] font-bold leading-tight tracking-[-0.04em] sm:text-[2.75rem] lg:text-[3.5rem]">What can I help with?</h1>
          )}

          {/* Error banner at the end if turns exist but error occurred */}
          {turns.length > 0 && status.type === 'error' && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-[10px] bg-mae-error-bg border border-mae-error text-sidebar-meta text-mae-error">
              <span className="shrink-0 text-base leading-tight">⚠</span>
              <span>{status.message}</span>
            </div>
          )}

        </div>
      </div>

      <div className="mx-auto w-full min-w-0 max-w-chat-col shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
        {runId && isBusy && (
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm text-mae-muted">You can leave this chat while Mae works.</span>
            <button type="button" onClick={handleStop} disabled={stopping}
              className="min-h-10 rounded-lg border border-mae-border px-3 text-sm hover:bg-mae-bubble-assistant disabled:opacity-50">
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          </div>
        )}
        {runId && browserState === 'waiting' && (
          <div className="mb-2 space-y-2 rounded-lg border border-mae-border p-3 text-sm text-mae-muted">
            <p>Open the Mae Browser Helper on a tab you own or have permission to use. Share only a table you’re comfortable sending to Mae and its model provider.</p>
            {!browserGrant ? (
              <button type="button" onClick={handleGrant} disabled={issuingGrant}
                className="min-h-10 rounded-lg border border-mae-border px-3 text-mae-text">
                {issuingGrant ? 'Creating code…' : 'Get browser grant code'}
              </button>
            ) : (
              <label className="block">Paste this code into the helper
                <input readOnly value={browserGrant} onFocus={event => event.currentTarget.select()}
                  className="mt-1 w-full rounded border border-mae-border bg-mae-bg p-2 text-mae-text" />
              </label>
            )}
            {grantError && <p role="alert">{grantError}</p>}
          </div>
        )}
        {speech.notice && <p role="status" className="mb-2 text-sm text-mae-muted">{speech.notice}</p>}
        {runId && stopError && <p role="alert" className="mb-2 text-sm text-mae-error">{stopError}</p>}
        <div className="flex items-end gap-1 rounded-[2.125rem] border border-mae-border bg-mae-surface shadow-[0_5px_16px_-7px_rgb(18_31_56_/_0.25)] focus-within:border-mae-accent sm:gap-2">
          <textarea
            ref={composerRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Mae anything…"
            aria-label="Message Mae"
            maxLength={100_000}
            disabled={isBusy || historyLoading}
            rows={1}
            className="block min-h-16 w-full min-w-0 max-h-[180px] resize-none rounded-[2.125rem] border-none bg-transparent py-[1.125rem] pl-4 text-base leading-7 text-mae-text placeholder:text-mae-muted focus-visible:outline-none disabled:opacity-50 sm:pl-6 sm:text-lg [field-sizing:content]"
          />
          <div className="flex shrink-0 items-center gap-1 py-2 pr-2 sm:gap-2">
            {speech.canDictate && (
              <button type="button" onClick={speech.dictate} disabled={isBusy || historyLoading}
                aria-label={speech.listening ? 'Stop dictation' : 'Dictate message'}
                aria-pressed={speech.listening} aria-describedby="dictation-note"
                className="grid size-11 place-items-center rounded-full text-mae-text hover:bg-mae-bubble-assistant aria-pressed:bg-mae-accent-soft disabled:opacity-50 sm:size-12">
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-3 0h6" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
              className="grid size-11 place-items-center rounded-full bg-mae-lime text-mae-text enabled:hover:brightness-95 disabled:cursor-not-allowed disabled:bg-mae-accent-soft disabled:text-mae-muted sm:size-12"
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
            </button>
          </div>
        </div>
        {!isBusy && (
          <label className="mt-2 inline-flex min-h-11 items-center gap-2.5 rounded-xl px-2 text-sm font-medium text-mae-muted hover:bg-mae-bubble-assistant sm:px-3">
            <input type="checkbox" className="size-4 shrink-0" checked={useBrowserTab} disabled={historyLoading}
              onChange={event => setUseBrowserTab(event.target.checked)} />
            Use a table from my browser
          </label>
        )}
        {showStarters && (
          <ul aria-label="Prompt starters" className="mt-1 space-y-0.5">
            {promptStarters.map(({ label, prompt, icon }) => (
              <li key={label}>
                <button type="button" onClick={() => {
                  setInput(prompt);
                  composerRef.current?.focus();
                }} className="flex min-h-11 items-center gap-3 rounded-xl px-2 text-left text-base font-medium text-mae-text hover:bg-mae-bubble-assistant sm:px-3">
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
                  {label}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p id="dictation-note" className="mt-2 px-2 text-sm leading-relaxed text-mae-muted sm:px-3">
          {speech.canDictate
            ? speech.listening ? 'Listening… Dictation may use your browser’s speech service.'
              : 'Dictation may use your browser’s speech service. Review your draft before sending.'
            : 'Dictation is not supported in this browser. You can still type.'}
        </p>
      </div>
    </div>
  );
}
