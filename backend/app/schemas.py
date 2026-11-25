from datetime import datetime
from uuid import UUID
from typing import Literal

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

class SignUpRequest(BaseModel):
    first_name: str
    last_name: str
    email: str
    password: str

class SignInRequest(BaseModel):
    email: str
    password: str

class UserOut(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    email: str
    has_openrouter_key: bool = False
    model_config = {"from_attributes": True}

class AuthResponse(BaseModel):
    user: UserOut

class OpenRouterKeyRequest(BaseModel):
    api_key: str

class ModelOut(BaseModel):
    id: str
    name: str
    context_length: int | None = None


# ── Chat ─────────────────────────────────────────────────────────────────────

class ChatRunRequest(BaseModel):
    run_id: UUID
    conversation_id: UUID
    content: str = Field(min_length=1, max_length=100_000)
    use_browser_tab: bool = False


# ── Conversation ─────────────────────────────────────────────────────────────

class ConversationCreateResponse(BaseModel):
    id: UUID
    title: str
    created_at: datetime


class ConversationListItem(BaseModel):
    id: UUID
    title: str
    created_at: datetime


class ConversationRenameRequest(BaseModel):
    title: str


class DocumentArtifact(BaseModel):
    filename: str
    display_name: str
    content_type: str
    size: int
    download_url: str
    download_name: str | None = None


class ChatRunSnapshot(BaseModel):
    id: UUID
    user_message_id: UUID
    user_content: str
    status: Literal["queued", "in_progress", "done", "failed", "cancelled", "interrupted", "incomplete"]
    content: str
    progress: str | None
    error: str | None
    artifacts: list[DocumentArtifact]
    browser_state: Literal["waiting", "received"] | None


class MessageOut(BaseModel):
    id: UUID
    role: str
    content: str
    model: str | None
    created_at: datetime
    artifacts: list[DocumentArtifact] = Field(default_factory=list)
    run_status: str | None = None


class ConversationDetail(BaseModel):
    id: UUID
    title: str
    created_at: datetime
    messages: list[MessageOut]


# ── Jobs ────────────────────────────────────────────────────────────────────

class JobEnqueueResponse(BaseModel):
    job_id: UUID


class JobStatusResponse(BaseModel):
    id: UUID
    type: str
    status: str
    title: str | None = None
    council_id: UUID | None = None
    payload: dict
    result: dict | None
    error: str | None
    created_at: datetime
    updated_at: datetime


class JobProgressEvent(BaseModel):
    type: str  # "progress" | "done" | "error"
    percent: int | None = None
    result: dict | None = None
    message: str | None = None
    job_id: UUID | None = None
    status: str | None = None


class RoutinePayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    prompt: str = Field(min_length=1, max_length=20_000)
    model: str | None = Field(default=None, min_length=1, max_length=200)


class AutomationScheduleCreate(BaseModel):
    name: str
    description: str | None = None
    task_type: str
    cron_expression: str
    timezone: str = "UTC"
    enabled: bool = True
    payload: dict


class AutomationScheduleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    cron_expression: str | None = None
    timezone: str | None = None
    enabled: bool | None = None
    payload: dict | None = None


class AutomationScheduleOut(AutomationScheduleCreate):
    id: UUID
    last_run_at: datetime | None = None
    last_job_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


# ── Council ─────────────────────────────────────────────────────────────────

class CouncilRequest(BaseModel):
    prompt: str
    system_prompt: str | None = None       # global fallback (per-member overrides it)
    models: list[str] | None = None        # inline override (ignored if council_id set)
    judge_model: str | None = None         # defaults to settings.default_model
    council_id: UUID | None = None         # use a saved council config


class CouncilMemberResult(BaseModel):
    model: str
    content: str | None = None
    error: str | None = None


class CouncilResult(BaseModel):
    prompt: str
    members: list[CouncilMemberResult]
    verdict: str | None = None
    judge_error: str | None = None
    judge_model: str | None = None


# ── Council Config CRUD ─────────────────────────────────────────────────────

class CouncilConfigMemberIn(BaseModel):
    model: str
    system_prompt: str | None = None


class CouncilConfigCreate(BaseModel):
    name: str
    description: str | None = None
    judge_model: str | None = None
    members: list[CouncilConfigMemberIn]


class CouncilConfigMemberOut(BaseModel):
    id: UUID
    model: str
    system_prompt: str | None = None
    position: int


class CouncilConfigListItem(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    judge_model: str | None = None
    created_at: datetime


class CouncilConfigDetail(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    judge_model: str | None = None
    created_at: datetime
    members: list[CouncilConfigMemberOut]


# ── Research ──────────────────────────────────────────────────────────────────

class ResearchRequest(BaseModel):
    query: str
    model: str | None = None          # model to use for synthesis (defaults to settings.default_model)


class ResearchSource(BaseModel):
    title: str
    url: str
    content: str


class ResearchResult(BaseModel):
    query: str
    sources: list[ResearchSource]
    report: str | None = None
    model: str | None = None


class DocumentFormat(StrEnum):
    docx = "docx"
    pptx = "pptx"
    xlsx = "xlsx"
    pdf = "pdf"


class DocumentMode(StrEnum):
    create = "create"
    edit = "edit"
    pdf_rebuild = "pdf_rebuild"
    pdf_merge = "pdf_merge"
    pdf_split = "pdf_split"


class ArtifactOut(DocumentArtifact):
    created_at: datetime


class DocumentPreview(BaseModel):
    summary: str
    text: str


class DocumentValidation(BaseModel):
    format: DocumentFormat
    checks: list[str]
    warnings: list[str] = []
    rendered_pages: int | None = None


class DocumentResult(BaseModel):
    format: DocumentFormat
    mode: DocumentMode
    prompt: str
    artifact: DocumentArtifact
    preview: DocumentPreview | None = None
    validation: DocumentValidation | None = None
