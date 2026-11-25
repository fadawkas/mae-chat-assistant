/** Matches the backend Pydantic models for conversations. */

export interface User { id: string; first_name: string; last_name: string; email: string; has_openrouter_key: boolean }

export type WorkspaceView = 'chat' | 'documents' | 'artifacts' | 'automation' | 'settings';

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  conversation_id?: string | null;
}

export type SSEEvent =
  | { type: 'token'; text: string }
  | { type: 'progress'; message: string }
  | { type: 'artifact'; artifact: DocumentArtifact }
  | { type: 'done'; conversation_id?: string | null }
  | { type: 'error'; message: string };

export interface ConversationListItem {
  id: string;
  title: string;
  created_at: string;
}

export interface MessageOut {
  id: string;
  role: string;
  content: string;
  model: string | null;
  created_at: string;
  artifacts?: DocumentArtifact[];
  run_status?: string | null;
}

export interface ConversationDetail {
  id: string;
  title: string;
  created_at: string;
  messages: MessageOut[];
}


// ── Jobs ─────────────────────────────────────────────────────────────────────

export interface JobStatus {
  id: string;
  type: string;
  status: string;
  title: string | null;
  council_id: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobEnqueueResponse {
  job_id: string;
}

export interface AutomationSchedule {
  id: string; name: string; description: string | null; task_type: 'agent' | 'research' | 'council' | 'document';
  cron_expression: string; timezone: string; enabled: boolean; payload: Record<string, unknown>;
  last_run_at: string | null; last_job_id: string | null; created_at: string; updated_at: string;
}

/** Council-specific event (Phase 4) — discriminated on phase. */
export type CouncilProgressEvent =
  | { type: "progress"; phase: "members"; model: string; member_id?: string; complete: boolean; error?: string; status?: string }
  | { type: "progress"; phase: "judging"; message: string; status?: string }
  | { type: "done"; result: CouncilResult; status: string }
  | { type: "error"; message: string; status: string };

export interface ResearchSource {
  title: string;
  url: string;
  content: string;
}

export interface ResearchResult {
  query: string;
  sources: ResearchSource[];
  report: string | null;
  model: string | null;
}

/** Research-specific event — discriminated on phase. */
export type ResearchProgressEvent =
  | { type: "progress"; phase: "searching"; message: string; status?: string }
  | { type: "progress"; phase: "searching"; complete: boolean; results_count: number; status?: string }
  | { type: "progress"; phase: "synthesizing"; message: string; status?: string }
  | { type: "done"; result: ResearchResult; status: string }
  | { type: "error"; message: string; status: string };

/** Union of all job progress event types. */
export type JobProgressEvent = CouncilProgressEvent | ResearchProgressEvent | DocumentProgressEvent;

export interface DocumentArtifact { filename: string; display_name: string; content_type: string; size: number; download_url: string; download_name?: string | null }
export interface Artifact extends DocumentArtifact { created_at: string }
export interface DocumentPreview { summary: string; text: string }
export interface DocumentValidation { format: string; checks: string[] }
export interface DocumentResult { format: string; mode: 'create' | 'edit' | 'pdf_rebuild' | 'pdf_merge' | 'pdf_split'; prompt: string; artifact: DocumentArtifact; preview?: DocumentPreview; render?: { pages: number; preview_url?: string }; validation?: DocumentValidation }
export type DocumentProgressEvent =
  | { type: "status"; status: string; message: string }
  | { type: "progress"; phase: string; message: string; status?: string }
  | { type: "code"; chunk: string; status: string }
  | { type: "retrying"; attempt: number; max_attempts: number; message: string; status: string }
  | { type: "done"; result: DocumentResult; status: string }
  | { type: "error"; message: string; status: string };


// ── Council ──────────────────────────────────────────────────────────────────

export interface CouncilMemberResult {
  model: string;
  content: string | null;
  error: string | null;
}

export interface CouncilResult {
  prompt: string;
  members: CouncilMemberResult[];
  verdict: string | null;
  judge_error: string | null;
  judge_model: string | null;
}

export interface CouncilRequest {
  prompt: string;
  system_prompt?: string | null;
  models?: string[] | null;
  judge_model?: string | null;
  council_id?: string | null;
}


// ── Council Config CRUD ─────────────────────────────────────────────────────

export interface CouncilConfigMemberIn {
  model: string;
  system_prompt?: string | null;
}

export interface CouncilConfigCreate {
  name: string;
  description?: string | null;
  judge_model?: string | null;
  members: CouncilConfigMemberIn[];
}

export interface CouncilConfigMemberOut {
  id: string;
  model: string;
  system_prompt: string | null;
  position: number;
}

export interface CouncilConfigListItem {
  id: string;
  name: string;
  description: string | null;
  judge_model: string | null;
  created_at: string;
}

export interface CouncilConfigDetail {
  id: string;
  name: string;
  description: string | null;
  judge_model: string | null;
  created_at: string;
  members: CouncilConfigMemberOut[];
}
