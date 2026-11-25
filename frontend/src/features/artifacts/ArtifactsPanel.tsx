import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import type { Artifact } from '../../types';
import { ArtifactEditor } from './ArtifactEditor';

const editable = /\.(docx|xlsx|pptx)$/i;
const isPdf = (file: Artifact) => file.content_type === 'application/pdf';
const isImage = (file: Artifact) => ['image/png', 'image/jpeg', 'image/webp'].includes(file.content_type);

function ImagePreview({ file }: { file: Artifact }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex aspect-video items-center justify-center overflow-hidden rounded-t-lg bg-mae-bg">
      {failed ? <span className="text-sm text-mae-muted">Preview unavailable</span> : (
        <img
          src={`/api/files/${encodeURIComponent(file.filename)}?inline=true`}
          alt={file.display_name}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      )}
    </div>
  );
}

const PAGE_SIZE = 50;
const actionClass = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg';
const iconProps = {
  'aria-hidden': true,
  className: 'size-[18px]',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function ArtifactsPanel({ refreshKey, onDocumentTools }: { refreshKey: number; onDocumentTools: () => void }) {
  const request = useRef<AbortController | null>(null);
  const [offset, setOffset] = useState(0);
  const [files, setFiles] = useState<Artifact[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [opened, setOpened] = useState<Artifact | null>(null);
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const [pendingCopy, setPendingCopy] = useState<string | null>(null);
  const lastOpened = useRef<string | null>(null);

  const load = useCallback(async (start: number) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(false);
    try {
      const res = await apiFetch(`/api/artifacts?limit=${PAGE_SIZE}&offset=${start}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Could not load artifacts');
      const batch: Artifact[] = await res.json();
      if (controller.signal.aborted) return;
      setFiles(previous => start
        ? [...new Map([...previous, ...batch].map(file => [file.filename, file])).values()]
        : batch);
      setOffset(start + batch.length);
      setHasMore(batch.length === PAGE_SIZE);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(0);
    return () => request.current?.abort();
  }, [refreshKey, load]);

  useEffect(() => {
    if (!pendingCopy) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    async function check() {
      try {
        const response = await apiFetch(`/api/jobs/${pendingCopy}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.ok) {
          setNotice('Edited copy saved to Artifacts.');
          setPendingCopy(null);
          void load(0);
          return;
        }
        if (response.status !== 404) attempts = 15;
      } catch {
        if (controller.signal.aborted) return;
      }
      if (++attempts < 15) timer = setTimeout(check, 2000);
      else {
        setNotice('The edited copy has not arrived. Refresh to check for it.');
        setPendingCopy(null);
      }
    }
    timer = setTimeout(check, 2000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [pendingCopy, load]);

  useEffect(() => {
    if (!opened && lastOpened.current) document.getElementById(lastOpened.current)?.focus();
  }, [opened]);

  async function deleteFile(file: Artifact, button: HTMLButtonElement) {
    if (deleting || !window.confirm(`Delete “${file.display_name}”? Existing links to this file will stop working. This cannot be undone.`)) return;

    setDeleting(file.filename);
    setDeleteError('');
    setNotice('');
    try {
      const res = await apiFetch(`/api/artifacts/${encodeURIComponent(file.filename)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error('Could not delete artifact');
      if (document.activeElement === button) heading.current?.focus();
      setFiles(previous => previous.filter(item => item.filename !== file.filename));
      setNotice(`Deleted “${file.display_name}”.`);
      void load(0);
    } catch {
      setDeleteError(`Could not delete “${file.display_name}”. Please try again.`);
    } finally {
      setDeleting(null);
    }
  }

  if (opened) return (
    <ArtifactEditor key={opened.filename} file={opened} pdf={isPdf(opened)} onClose={copy => {
      setOpened(null);
      if (copy) {
        setNotice('Waiting for the edited copy…');
        setPendingCopy(copy);
      }
    }} />
  );

  return (
    <section className="workspace-page" aria-labelledby="artifacts-heading">
      <div className="workspace-content">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 id="artifacts-heading" ref={heading} tabIndex={-1} className="workspace-heading">Artifacts</h1>
          <div className="flex flex-wrap gap-1 text-sm">
            <button onClick={() => load(0)} disabled={loading} className="min-h-10 rounded-lg px-2 text-mae-muted hover:bg-mae-bubble-assistant hover:text-mae-text disabled:opacity-50">Refresh</button>
            <button onClick={onDocumentTools} className="min-h-10 rounded-lg px-2 text-mae-muted hover:bg-mae-bubble-assistant hover:text-mae-text">Document tools</button>
          </div>
        </header>
        {notice && <p role="status" className="mb-4 text-sm text-mae-muted">{notice}</p>}
        {deleteError && <p role="alert" className="mb-4 text-sm text-mae-error">{deleteError}</p>}
        {error && (
          <p role="alert" className="mb-4 text-sm text-mae-error">
            Could not load files. <button onClick={() => load(0)} className="underline">Try again</button>
          </p>
        )}
        {files.length ? (
          [true, false].map(images => {
            const group = files.filter(file => isImage(file) === images);
            if (!group.length) return null;
            return (
              <ul key={String(images)} aria-label={images ? 'Generated images' : 'Other artifacts'} className={images
                ? 'mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'
                : 'divide-y divide-mae-border border-y border-mae-border'}>
                {group.map(file => (
                  <li key={file.filename} className={images
                    ? 'flex min-w-0 flex-col rounded-lg border border-mae-border bg-mae-surface'
                    : 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5'}>
                    {images && <ImagePreview file={file} />}
                    <div className={images ? 'flex flex-1 flex-col justify-between px-3 pt-3' : 'contents'}>
                      <div className={images ? 'min-w-0' : 'min-w-0 flex-1 basis-32'}>
                        <p className="break-words text-sm font-medium text-mae-text">{file.display_name}</p>
                        <p className="mt-1 text-xs text-mae-muted">
                          {file.size < 1024 ? `${file.size} B` : `${Math.ceil(file.size / 1024)} KB`} ·{' '}
                          <time dateTime={file.created_at}>{new Date(file.created_at).toLocaleDateString()}</time>
                        </p>
                      </div>
                      <div className="flex max-w-full shrink-0 flex-wrap justify-end gap-1">
                        {(isPdf(file) || editable.test(file.filename)) && (
                          <button id={`open-${file.filename}`} onClick={event => {
                            lastOpened.current = event.currentTarget.id;
                            setOpened(file);
                          }} title={isPdf(file) ? 'Preview' : 'Edit'} aria-label={`${isPdf(file) ? 'Preview' : 'Edit'} ${file.display_name}`} className={`${actionClass} gap-1.5 px-2 text-sm text-mae-accent hover:bg-mae-bubble-assistant`}>
                            <span>{isPdf(file) ? 'Preview' : 'Edit'}</span>
                            <svg {...iconProps}>
                              {isPdf(file) ? (
                                <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" /></>
                              ) : (
                                <path d="m15 5 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z" />
                              )}
                            </svg>
                          </button>
                        )}
                        <a href={file.download_url} download={file.download_name ?? true} title="Download" aria-label={`Download ${file.display_name}`} className={`${actionClass} gap-1.5 px-2 text-sm hover:bg-mae-bubble-assistant ${isPdf(file) || editable.test(file.filename) ? 'text-mae-muted' : 'text-mae-accent'}`}>
                          {!isPdf(file) && !editable.test(file.filename) && <span>Download</span>}
                          <svg {...iconProps}><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" /></svg>
                        </a>
                        <button
                          type="button"
                          onClick={event => void deleteFile(file, event.currentTarget)}
                          title={deleting === file.filename ? 'Deleting…' : 'Delete'}
                          aria-label={`Delete ${file.display_name}`}
                          aria-busy={deleting === file.filename}
                          aria-disabled={deleting !== null}
                          className={`${actionClass} text-mae-muted hover:bg-mae-error-bg hover:text-mae-error aria-disabled:opacity-50`}
                        >
                          {deleting === file.filename ? (
                            <svg {...iconProps} className={`${iconProps.className} motion-safe:animate-spin`}><path d="M12 3a9 9 0 1 1-9 9" /></svg>
                          ) : (
                            <svg {...iconProps}><path d="M3 6h18m-15 0 1 14h10l1-14M9 6V3h6v3m-5 4v6m4-6v6" /></svg>
                          )}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            );
          })
        ) : !loading && !error && (
          <div className="border-y border-mae-border py-4 text-sm text-mae-muted">
            <p className="mb-1 font-medium text-mae-text">No files yet</p>
            <p>Ask Mae to make a spreadsheet, report, or other file in chat. It’ll appear here when it’s ready.</p>
          </div>
        )}
        {loading && <p role="status" className="mt-4 text-sm text-mae-muted">Loading files…</p>}
        {!loading && hasMore && !error && (
          <button onClick={() => load(offset)} className="mt-4 rounded-lg border border-mae-border px-3 py-2 text-sm text-mae-text">Load more</button>
        )}
      </div>
    </section>
  );
}
