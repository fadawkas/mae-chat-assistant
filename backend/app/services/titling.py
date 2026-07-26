"""Background title generation for conversations and jobs.

Uses a cheap/free OpenRouter model to produce concise titles so the
sidebar doesn't just show the first user message or raw query.
"""
import asyncio
import logging
from uuid import UUID

from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session_factory
from app.models import Conversation, Job
from app.services.openrouter import OpenRouterClient

logger = logging.getLogger("mae.titling")

MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 2


def _build_titling_prompt(content: str, kind: str) -> str:
    """Build a prompt for the titling model."""
    kind_label = {
        "chat": "chat conversation",
        "research": "research query",
        "council": "council discussion prompt",
        "document": "document request",
    }.get(kind, "content")
    return (
        f"Write a short title (max 5 words) summarizing this {kind_label}.\n"
        f"Respond with ONLY the title \u2014 no quotes, no punctuation, no explanation.\n\n"
        f"{content}"
    )


async def generate_title(content: str, kind: str = "chat", api_key: str | None = None) -> str | None:
    """Generate a short title using the cheap/free titling model.

    Retries up to MAX_RETRIES times with exponential backoff.
    Returns the title string, or ``None`` if generation fails.
    """
    prompt = _build_titling_prompt(content, kind)

    for attempt in range(1, MAX_RETRIES + 1):
        client = OpenRouterClient(api_key)
        try:
            title = await client.complete(settings.titling_model, [
                {"role": "user", "content": prompt},
            ])
            title = title.strip().strip('"').strip("'").strip()
            if len(title) > 80:
                title = title[:80]
            return title
        except Exception as e:
            logger.warning(
                "title generation attempt %d/%d failed for %s: %s",
                attempt, MAX_RETRIES, kind, e,
            )
            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY_SECONDS * attempt)
        finally:
            await client.close()

    return None


async def title_conversation(conversation_id: UUID, first_user_message: str) -> None:
    """Fire-and-forget: generate a title for a conversation and persist it."""
    title = await generate_title(first_user_message, kind="chat")
    if title is None:
        logger.warning(
            "failed to generate title for conversation %s after %d retries; keeping default",
            conversation_id, MAX_RETRIES,
        )
        return

    async with async_session_factory() as db:
        result = await db.execute(
            select(Conversation).where(Conversation.id == conversation_id)
        )
        conv = result.scalar_one_or_none()
        if conv is not None:
            conv.title = title
            await db.commit()
            logger.info("titled conversation %s: %s", conversation_id, title)


async def title_job(job_id: UUID, prompt: str, kind: str, api_key: str | None = None) -> None:
    """Fire-and-forget: generate a title for a job and persist it."""
    title = await generate_title(prompt, kind, api_key)
    if title is None:
        logger.warning(
            "failed to generate title for job %s (%s) after %d retries; keeping default",
            job_id, kind, MAX_RETRIES,
        )
        return

    async with async_session_factory() as db:
        result = await db.execute(select(Job).where(Job.id == job_id))
        job = result.scalar_one_or_none()
        if job is not None:
            job.title = title
            await db.commit()
            logger.info("titled job %s (%s): %s", job_id, kind, title)
