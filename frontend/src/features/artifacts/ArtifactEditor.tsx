import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import type { Artifact } from '../../types';

type OfficeEditor = { destroyEditor(): void };
type OfficeApi = { DocEditor: new (id: string, config: Record<string, unknown>) => OfficeEditor };
type EditorResponse = { copy_id: string; script_url: string; config: Record<string, unknown> };

const scripts = new Map<string, Promise<OfficeApi>>();
function loadOffice(url: string) {
  const existing = scripts.get(url);
  if (existing) return existing;
  const ready = new Promise<OfficeApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => {
      const api = (window as Window & { DocsAPI?: OfficeApi }).DocsAPI;
      if (api?.DocEditor) resolve(api);
      else reject(new Error('The Office editor could not initialize.'));
    };
    script.onerror = () => reject(new Error('Could not connect to the Office editor.'));
    document.head.append(script);
  }).catch(error => { scripts.delete(url); throw error; });
  scripts.set(url, ready);
  return ready;
}

export function ArtifactEditor({ file, pdf, onClose }: { file: Artifact; pdf: boolean; onClose: (copyId: string | null) => void }) {
  const [status, setStatus] = useState('Loading editor…');
  const [error, setError] = useState('');
  const [copyId, setCopyId] = useState<string | null>(null);
  const focusHeading = useCallback((element: HTMLHeadingElement | null) => element?.focus(), []);

  useEffect(() => {
    if (pdf) return;
    const controller = new AbortController();
    let editor: OfficeEditor | undefined;
    async function open() {
      try {
        const response = await apiFetch(`/api/artifacts/${encodeURIComponent(file.filename)}/editor`, {
          method: 'POST', signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not open the artifact.');
        }
        const { copy_id, script_url, config }: EditorResponse = await response.json();
        const api = await loadOffice(script_url);
        if (controller.signal.aborted) return;
        editor = new api.DocEditor('mae-office-editor', {
          ...config,
          events: {
            onAppReady: () => setStatus(''),
            onDocumentStateChange: (event: { data?: boolean }) => {
              if (event.data) setCopyId(copy_id);
            },
            onError: () => { setError('The Office editor could not open or save this file.'); setStatus(''); },
          },
        });
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Could not open the artifact.');
          setStatus('');
        }
      }
    }
    void open();
    return () => { controller.abort(); editor?.destroyEditor(); };
  }, [file.filename, pdf]);

  return (
    <section aria-label={pdf ? 'PDF preview' : 'Office editor'} className="flex min-w-0 flex-1 flex-col bg-mae-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-mae-border px-4 py-3">
        <div className="min-w-0">
          <h1 tabIndex={-1} ref={focusHeading} className="break-words font-semibold text-mae-text">{file.display_name}</h1>
          <p className="text-xs text-mae-muted">{pdf ? 'Read-only preview' : 'Edits are saved as a separate copy after closing.'}</p>
        </div>
        <div className="flex shrink-0 gap-2 text-sm text-mae-text">
          <a className="rounded-lg border border-mae-border px-3 py-2" href={file.download_url} download>Download original</a>
          <button className="rounded-lg border border-mae-border px-3 py-2" onClick={() => onClose(copyId)}>{pdf ? 'Close preview' : 'Close editor'}</button>
        </div>
      </header>
      {pdf ? (
        <iframe title={`PDF preview: ${file.display_name}`} src={`/api/files/${encodeURIComponent(file.filename)}?inline=true`} className="min-h-0 w-full flex-1 bg-white" />
      ) : (
        <>
          {status && <p className="px-4 py-3 text-sm text-mae-muted" role="status">{status}</p>}
          {error && <p className="px-4 py-3 text-sm text-mae-error" role="alert">{error}</p>}
          <div className="min-h-0 flex-1" hidden={!!error}>
            <div id="mae-office-editor" className="h-full w-full" />
          </div>
        </>
      )}
    </section>
  );
}
