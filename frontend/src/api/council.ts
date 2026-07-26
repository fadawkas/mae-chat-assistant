import type { JobEnqueueResponse } from '../types';

/**
 * Enqueue an LLM council job.
 */
export async function enqueueCouncil(
  prompt: string,
  options?: {
    systemPrompt?: string | null;
    models?: string[] | null;
    judgeModel?: string | null;
    councilId?: string | null;
  },
): Promise<JobEnqueueResponse> {
  const body: Record<string, unknown> = { prompt };
  if (options?.systemPrompt !== undefined) body.system_prompt = options.systemPrompt;
  if (options?.models !== undefined) body.models = options.models;
  if (options?.judgeModel !== undefined) body.judge_model = options.judgeModel;
  if (options?.councilId !== undefined) body.council_id = options.councilId;

  const res = await fetch('/api/council', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Council enqueue failed (${res.status}): ${text}`);
  }
  return res.json();
}
