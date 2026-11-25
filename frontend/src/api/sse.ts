import type { ChatRequest, SSEEvent } from '../types';
import { apiFetch } from './client';

/**
 * Stream a chat-completion response from the backend via SSE.
 *
 * Returns an async generator of typed events.  Callers should use
 * `for-await-of` to process tokens as they arrive.
 */
export async function* streamChat(
  payload: ChatRequest,
): AsyncGenerator<SSEEvent> {
  const res = await apiFetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chat request failed (${res.status}): ${text}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const frames = buf.split('\n\n');
      buf = frames.pop()!;

      for (const frame of frames) {
        if (!frame.startsWith('data: ')) continue;
        try {
          yield JSON.parse(frame.slice(6)) as SSEEvent;
        } catch {
          // skip unparseable frames
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
