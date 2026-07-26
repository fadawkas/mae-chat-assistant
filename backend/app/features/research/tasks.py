"""Research skill: search the web via Tavily, then synthesize a report.

ARQ job implementation for Phase 5.
"""
import asyncio
import json
import logging
import uuid

import httpx
import redis.asyncio as aioredis
from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session_factory
from app.models import Job
from app.services.openrouter import OpenRouterClient
from app.workers.queue import PROGRESS_CHANNEL
from app.workers.context import job_owner_and_key
from app.services.titling import title_job

logger = logging.getLogger("mae.research")

# Maximum characters of source content to include in the synthesis prompt.
_MAX_SOURCE_CHARS = 15_000
_MAX_TOTAL_CONTENT_CHARS = 60_000


def _build_synthesis_prompt(query: str, sources: list[dict]) -> str:
    """Build a prompt for the synthesis model from search results."""
    parts = [
        "You are a research assistant tasked with synthesizing a report from web search results.",
        "",
        f"## Research query",
        query,
        "",
        "## Search results",
    ]

    total_chars = 0
    for i, source in enumerate(sources, 1):
        title = source.get("title", "Untitled")
        url = source.get("url", "")
        content = source.get("content", "")
        # Truncate individual source content
        if len(content) > _MAX_SOURCE_CHARS:
            content = content[:_MAX_SOURCE_CHARS] + "\n[...truncated]"
        parts.append(f"\n### Source {i}: {title}")
        parts.append(f"URL: {url}")
        parts.append(content)
        total_chars += len(content)
        if total_chars > _MAX_TOTAL_CONTENT_CHARS:
            parts.append("\n[...remaining sources omitted due to length]")
            break

    parts.extend([
        "",
        "## Your task",
        f"Write a comprehensive, well-structured report addressing the query: \"{query}\"",
        "",
        "Base your report **only** on the search results provided above.",
        "- Cite sources inline using [Source N] references.",
        "- If the search results are insufficient to fully answer the query, state this clearly.",
        "- Organize the report with sections and bullet points where appropriate.",
        "- Include a brief summary at the beginning.",
    ])
    return "\n".join(parts)


async def research_job(ctx: dict, job_id_str: str, payload: dict) -> dict:
    """
    ARQ job: search the web via Tavily, then synthesize a report.

    Steps:
      1. Call Tavily ``POST /search`` with ``include_raw_content=true``.
      2. Publish progress with result count.
      3. If results exist, call the synthesis model to produce a report.
      4. Write result to the jobs table.
    """
    job_id = uuid.UUID(job_id_str)
    _, api_key = await job_owner_and_key(job_id)
    query = payload.get("query", "")
    model = payload.get("model") or settings.default_model

    # Obtain a Redis connection for progress publishing.
    redis: aioredis.Redis = ctx.get("redis")
    if not hasattr(redis, "publish"):
        redis = aioredis.from_url(settings.redis_url, decode_responses=True)

    client = OpenRouterClient(api_key)

    try:
        # Mark active
        async with async_session_factory() as db:
            result = await db.execute(select(Job).where(Job.id == job_id))
            job = result.scalar_one()
            job.status = "active"
            await db.commit()

        # ── 1. Search via Tavily ────────────────────────────────────────────
        await redis.publish(
            PROGRESS_CHANNEL.format(job_id_str),
            json.dumps({
                "type": "progress",
                "phase": "searching",
                "message": "Searching the web...",
            }),
        )

        search_results = await _search_tavily(query)

        sources = []
        for r in search_results.get("results", []):
            sources.append({
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": r.get("raw_content", r.get("content", "")),
            })

        await redis.publish(
            PROGRESS_CHANNEL.format(job_id_str),
            json.dumps({
                "type": "progress",
                "phase": "searching",
                "complete": True,
                "results_count": len(sources),
            }),
        )

        # ── 2. Check if any results were found ─────────────────────────────
        if not sources:
            error_msg = "No search results found for the query"
            logger.warning("research %s: %s", job_id_str, error_msg)
            result_payload = {
                "query": query,
                "sources": [],
                "report": None,
                "model": model,
            }
            async with async_session_factory() as db:
                result = await db.execute(select(Job).where(Job.id == job_id))
                job = result.scalar_one()
                job.status = "done"
                job.result = result_payload
                await db.commit()
            await redis.publish(
                PROGRESS_CHANNEL.format(job_id_str),
                json.dumps({
                    "type": "done",
                    "result": result_payload,
                    "status": "done",
                }),
            )
            return result_payload

        # ── 3. Synthesis ────────────────────────────────────────────────────
        await redis.publish(
            PROGRESS_CHANNEL.format(job_id_str),
            json.dumps({
                "type": "progress",
                "phase": "synthesizing",
                "message": "Synthesizing report...",
            }),
        )

        synthesis_prompt = _build_synthesis_prompt(query, sources)
        synthesis_messages = [{"role": "user", "content": synthesis_prompt}]

        report = None
        synthesis_error = None
        try:
            report = await client.complete(model, synthesis_messages)
        except Exception as exc:
            synthesis_error = f"{type(exc).__name__}: {exc}"
            logger.warning("research synthesis failed for %s: %s", job_id_str, synthesis_error)

        # ── 4. Write result ────────────────────────────────────────────────
        result_payload = {
            "query": query,
            "sources": sources,
            "report": report,
            "model": model,
        }

        async with async_session_factory() as db:
            result = await db.execute(select(Job).where(Job.id == job_id))
            job = result.scalar_one()
            job.status = "done"
            job.result = result_payload
            await db.commit()

        # Fire background title generation
        asyncio.create_task(title_job(job_id, query, "research", api_key=api_key))

        await redis.publish(
            PROGRESS_CHANNEL.format(job_id_str),
            json.dumps({
                "type": "done",
                "result": result_payload,
                "status": "done",
            }),
        )

        logger.info(
            "research %s done: %d sources, report=%s",
            job_id_str, len(sources),
            "ok" if report else f"error={synthesis_error}",
        )

        return result_payload

    except Exception as exc:
        logger.exception("research_job failed for job %s", job_id_str)
        error_msg = f"{type(exc).__name__}: {exc}"
        async with async_session_factory() as db:
            result = await db.execute(select(Job).where(Job.id == job_id))
            job = result.scalar_one()
            job.status = "failed"
            job.error = error_msg
            await db.commit()
        await redis.publish(
            PROGRESS_CHANNEL.format(job_id_str),
            json.dumps({"type": "error", "message": error_msg, "status": "failed"}),
        )
        raise

    finally:
        await client.close()
        if redis is not ctx.get("redis"):
            await redis.aclose()


async def _search_tavily(query: str) -> dict:
    """Call the Tavily Search API and return the raw response dict."""
    api_key = settings.search_api_key
    if not api_key:
        logger.warning("MAE_SEARCH_API_KEY is not set — search will fail")
        return {"results": []}

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{settings.search_base_url}/search",
            json={
                "api_key": api_key,
                "query": query,
                "include_raw_content": True,
                "max_results": 10,
            },
        )
        if not response.is_success:
            logger.error(
                "Tavily returned %s: %s", response.status_code, response.text
            )
            return {"results": []}
        return response.json()
