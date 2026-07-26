export interface ModelOption { id: string; name: string; context_length?: number | null }
export async function fetchModels(): Promise<ModelOption[]> {
  const response = await fetch('/api/models', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Unable to load models (${response.status})`);
  return response.json();
}
