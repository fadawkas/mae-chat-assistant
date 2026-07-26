import type {
  CouncilConfigCreate,
  CouncilConfigDetail,
  CouncilConfigListItem,
} from '../types';

export async function createCouncil(
  body: CouncilConfigCreate,
): Promise<CouncilConfigDetail> {
  const res = await fetch('/api/councils', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create council failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function listCouncils(): Promise<CouncilConfigListItem[]> {
  const res = await fetch('/api/councils');
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`List councils failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getCouncil(
  id: string,
): Promise<CouncilConfigDetail> {
  const res = await fetch(`/api/councils/${id}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get council failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function updateCouncil(
  id: string,
  body: CouncilConfigCreate,
): Promise<CouncilConfigDetail> {
  const res = await fetch(`/api/councils/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Update council failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function deleteCouncil(id: string): Promise<void> {
  const res = await fetch(`/api/councils/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete council failed (${res.status}): ${text}`);
  }
}