import type { AutomationSchedule } from '../types';
import { apiFetch } from './client';

export async function listAutomationSchedules(): Promise<AutomationSchedule[]> {
  const response = await apiFetch('/api/automation/schedules');
  if (!response.ok) throw new Error('Unable to load automation schedules');
  return response.json();
}

export async function createAutomationSchedule(input: Omit<AutomationSchedule, 'id' | 'last_run_at' | 'last_job_id' | 'created_at' | 'updated_at'>): Promise<AutomationSchedule> {
  const response = await apiFetch('/api/automation/schedules', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function deleteAutomationSchedule(id: string): Promise<void> {
  const response = await apiFetch(`/api/automation/schedules/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Unable to delete schedule');
}

export async function runAutomationSchedule(id: string): Promise<{ job_id: string }> {
  const response = await apiFetch(`/api/automation/schedules/${id}/run`, { method: 'POST' });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
