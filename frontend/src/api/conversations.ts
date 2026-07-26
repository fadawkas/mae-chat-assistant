import type { ConversationDetail, ConversationListItem } from '../types';
import { apiFetch } from './client';

export async function fetchConversations(): Promise<ConversationListItem[]> {
  const res = await apiFetch('/api/conversations');
  if (!res.ok) throw new Error(`Failed to fetch conversations (${res.status})`);
  return res.json();
}

export async function fetchConversation(id: string): Promise<ConversationDetail> {
  const res = await apiFetch(`/api/conversations/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch conversation (${res.status})`);
  return res.json();
}

export async function createConversation(): Promise<ConversationListItem> {
  const res = await apiFetch('/api/conversations', { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to create conversation (${res.status})`);
  return res.json();
}

export async function renameConversation(id: string, title: string): Promise<ConversationListItem> {
  const res = await apiFetch(`/api/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Failed to rename conversation (${res.status})`);
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await apiFetch(`/api/conversations/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete conversation (${res.status})`);
}
