import type { JobProgressEvent, JobStatus } from '../types';
import { apiFetch } from './client';

/**
 * List recent jobs, optionally filtered by type and/or council_id.
 */
export async function listJobs(type?: string, limit = 20, councilId?: string): Promise<JobStatus[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (type) params.set('type', type);
  if (councilId) params.set('council_id', councilId);
  const res = await apiFetch(`/api/jobs?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`List jobs failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Poll the current status of a job by ID.
 */
export async function fetchJobStatus(jobId: string): Promise<JobStatus> {
  const res = await apiFetch(`/api/jobs/${jobId}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fetch job failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Delete a job record.
 */
export async function deleteJob(jobId: string): Promise<void> {
  const res = await apiFetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete job failed (${res.status}): ${text}`);
  }
}

/**
 * Stream job progress events via SSE.
 *
 * Returns an async generator of parsed JobProgressEvent objects.
 */
export async function* streamJobProgress(
  jobId: string,
): AsyncGenerator<JobProgressEvent> {
  const res = await apiFetch(`/api/jobs/${jobId}/stream`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Job stream failed (${res.status}): ${text}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });

    const frames = buf.split('\n\n');
    buf = frames.pop()!;

    for (const frame of frames) {
      if (!frame.startsWith('data: ')) continue;
      try {
        yield JSON.parse(frame.slice(6)) as JobProgressEvent;
      } catch {
        // skip unparseable frames
      }
    }
  }
}
