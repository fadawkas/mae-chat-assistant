export async function enqueueDocument(data: { format: string; mode: string; prompt: string; title: string; model: string; file?: File; files?: File[]; page_start?: number; page_end?: number }): Promise<{ job_id: string }> {
  const body = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined) return;
    if (key === 'files' && Array.isArray(value)) value.forEach(file => body.append('files', file));
    else if (value instanceof File) body.append(key, value);
    else if (!Array.isArray(value)) body.append(key, String(value));
  });
  const res = await fetch('/api/documents', { method: 'POST', body });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `Document enqueue failed: ${res.status}`);
  }
  return res.json();
}
