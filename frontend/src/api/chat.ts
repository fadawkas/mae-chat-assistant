import type { DocumentArtifact } from '../types';
import { apiFetch } from './client';

export interface ChatRun {
  id: string;
  user_message_id: string;
  user_content: string;
  status: 'queued' | 'in_progress' | 'done' | 'failed' | 'cancelled' | 'interrupted' | 'incomplete';
  content: string;
  progress: string | null;
  error: string | null;
  artifacts: DocumentArtifact[];
  browser_state: 'waiting' | 'received' | null;
}

async function check(response: Response, fallback: string) {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === 'string' ? body.detail : fallback);
  }
  return response;
}

export function newChatRunId() {
  // getRandomValues also works when Mae is served over HTTP on a LAN.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export async function submitChat(conversationId: string, runId: string, content: string, useBrowserTab: boolean) {
  await check(await apiFetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: conversationId, run_id: runId, content, use_browser_tab: useBrowserTab }),
  }), 'Could not start this chat run.');
}

export async function fetchChatRun(conversationId: string, runId?: string, signal?: AbortSignal): Promise<ChatRun | null> {
  const query = runId ? `?run_id=${encodeURIComponent(runId)}` : '';
  const result = await check(await apiFetch(`/api/chat/${conversationId}${query}`, {
    signal, cache: 'no-store',
  }), 'Could not load this chat run.');
  return result.json();
}

export async function issueBrowserGrant(runId: string): Promise<{ code: string }> {
  const response = await check(await apiFetch(`/api/chat/${runId}/browser-grant`, { method: 'POST' }),
    'Could not issue a browser grant.');
  return response.json();
}

export async function stopChatRun(runId: string) {
  await check(await apiFetch(`/api/chat/${runId}/stop`, { method: 'POST' }), 'Could not stop this chat run.');
}
