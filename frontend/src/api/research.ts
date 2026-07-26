const API_BASE = '/api';

export async function enqueueResearch(query: string, model?: string | null): Promise<{ job_id: string }> {
  const res = await fetch(`${API_BASE}/research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, model: model || null }),
  });
  if (!res.ok) {
    throw new Error(`Research enqueue failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}