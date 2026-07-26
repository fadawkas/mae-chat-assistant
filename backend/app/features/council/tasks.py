"""LLM council: fan-out to multiple models, then synthesize a verdict.

ARQ job implementation for Phase 4.
"""
import asyncio
import json
import logging
import uuid

import redis.asyncio as aioredis
from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session_factory
from app.models import Job
from app.services.openrouter import OpenRouterClient
from app.workers.queue import PROGRESS_CHANNEL
from app.workers.context import job_owner_and_key
from app.services.titling import title_job

logger = logging.getLogger("mae.council")

# Maximum time per model call (seconds).
_TIMEOUT = settings.council_timeout_seconds


def _build_judge_prompt(original_prompt: str, members: list[dict]) -> str:
    """Build a synthesis prompt for the judge model."""
    parts = [
        "You are a judge tasked with synthesizing responses from multiple AI models.",
        "",
        f"## Original user prompt",
        original_prompt,
        "",
        "## Responses from each model",
    ]
    for member in members:
        parts.append(f"\n### {member['model']}")
        if member.get("error"):
            parts.append(f"[Error: {member['error']}]")
        elif member.get("content"):
            parts.append(member["content"])
        else:
            parts.append("[No response]")
    parts.extend([
        "",
        "## Your task",
        "Synthesize a balanced final verdict that:",
        "- Identifies areas of agreement and disagreement between the models",
        "- Highlights unique insights from each model",
        "- Provides a coherent, well-reasoned answer to the original prompt",
        "",
        "Format your response as a clear synthesis with sections if appropriate.",
    ])
    return "\n".join(parts)


async def council_job(ctx: dict, job_id_str: str, payload: dict) -> dict:
    """
    ARQ job: fan out a prompt to N models, then synthesize a verdict.

    Steps:
      1. Fan out to all member models with ``asyncio.gather``, each wrapped
         in ``asyncio.wait_for(complete(...), timeout=<TIMEOUT>)`` so a
         hanging model doesn't block the others.
      2. Publish a progress event as each member completes.
      3. If at least one member succeeded, call the judge model.
         - If the judge fails, the job still completes with ``status="done"``
           but ``verdict=None`` and ``judge_error`` set.
      4. If *all* members failed, fail the job.
    """
    job_id = uuid.UUID(job_id_str)
    _, api_key = await job_owner_and_key(job_id)
    prompt = payload.get("prompt", "")
    raw_models = payload.get("models")
    if not raw_models:
        raw_models = settings.council_models.split(",")
    models = raw_models
    judge_model = payload.get("judge_model") or settings.default_model

    # Obtain a Redis connection for progress publishing.
    redis: aioredis.Redis = ctx.get("redis")
    if not hasattr(redis, "publish"):
        redis = aioredis.from_url(settings.redis_url, decode_responses=True)

    # Create a client for the worker (separate process from the API).
    client = OpenRouterClient(api_key)

    try:
        # Mark active
        async with async_session_factory() as db:
            result = await db.execute(select(Job).where(Job.id == job_id))
            job = result.scalar_one()
            job.status = "active"
            await db.commit()

        # ── 1. Fan-out to members ─────────────────────────────────────────
        # Build per-member configs: either from saved council config or inline.
        member_configs = payload.get("member_configs")
        global_system_prompt = payload.get("system_prompt")

        if member_configs:
            # Saved council — each member has its own model + system_prompt.
            member_specs = member_configs
        else:
            # Inline mode — same global system_prompt for all.
            member_specs = [
                {"model": m, "system_prompt": global_system_prompt}
                for m in models
            ]

        async def _call_member(spec: dict) -> dict:
            """Call one member model with a timeout."""
            model = spec["model"]
            system_prompt = spec.get("system_prompt")
            result = {"model": model, "id": spec.get("id"), "content": None, "error": None}

            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})

            try:
                content = await asyncio.wait_for(
                    client.complete(model, messages),
                    timeout=_TIMEOUT,
                )
                result["content"] = content
            except asyncio.TimeoutError:
                result["error"] = f"Timeout after {_TIMEOUT}s"
                logger.warning("council member %s timed out after %ss", model, _TIMEOUT)
            except Exception as exc:
                result["error"] = f"{type(exc).__name__}: {exc}"
                logger.warning("council member %s failed: %s", model, result["error"])
            return result

        tasks = [_call_member(spec) for spec in member_specs]
        members = []

        for coro in asyncio.as_completed(tasks):
            member = await coro
            members.append(member)
            await redis.publish(
                PROGRESS_CHANNEL.format(job_id_str),
                json.dumps({
                    "type": "progress",
                    "phase": "members",
                    "model": member["model"],
                    "member_id": member.get("id"),
                    "complete": True,
                    "error": member.get("error"),
                }),
            )

        # ── 2. Check if any member succeeded ──────────────────────────────
        successes = [m for m in members if m["content"] is not None]
        if not successes:
            error_msg = "All council members failed — no responses to synthesize"
            logger.error("council %s: %s", job_id_str, error_msg)
            async with async_session_factory() as db:
                result = await db.execute(select(Job).where(Job.id == job_id))
                job = result.scalar_one()
                job.status = "failed"
                job.error = error_msg
                job.result = {
                    "prompt": prompt,
                    "members": members,
                    "verdict": None,
                    "judge_error": None,
                    "judge_model": judge_model,
                }
                await db.commit()
            await redis.publish(
                PROGRESS_CHANNEL.format(job_id_str),
                json.dumps({"type": "error", "message": error_msg, "status": "failed"}),
            )
            return {"error": error_msg}

        # ── 3. Judge synthesis ────────────────────────────────────────────
        await redis.publish(
            PROGRESS_CHANNEL.format(job_id_str),
            json.dumps({
                "type": "progress",
                "phase": "judging",
                "message": "Synthesizing verdict...",
            }),
        )

        judge_prompt = _build_judge_prompt(prompt, members)
        judge_messages = [{"role": "user", "content": judge_prompt}]

        verdict = None
        judge_error = None
        try:
            verdict = await asyncio.wait_for(
                client.complete(judge_model, judge_messages),
                timeout=_TIMEOUT,
            )
        except asyncio.TimeoutError:
            judge_error = f"Judge timed out after {_TIMEOUT}s"
            logger.warning("council judge %s timed out", judge_model)
        except Exception as exc:
            judge_error = f"{type(exc).__name__}: {exc}"
            logger.warning("council judge %s failed: %s", judge_model, judge_error)

        # ── 4. Write result ───────────────────────────────────────────────
        result_payload = {
            "prompt": prompt,
            "members": members,
            "verdict": verdict,
            "judge_error": judge_error,
            "judge_model": judge_model,
        }

        async with async_session_factory() as db:
            result = await db.execute(select(Job).where(Job.id == job_id))
            job = result.scalar_one()
            job.status = "done"
            job.result = result_payload
            await db.commit()

        # Fire background title generation
        asyncio.create_task(title_job(job_id, prompt, "council", api_key=api_key))

        await redis.publish(
            PROGRESS_CHANNEL.format(job_id_str),
            json.dumps({
                "type": "done",
                "result": result_payload,
                "status": "done",
            }),
        )

        logger.info(
            "council %s done: %d/%d members succeeded, judge=%s",
            job_id_str, len(successes), len(models),
            "ok" if verdict else f"error={judge_error}",
        )

        return result_payload

    except Exception as exc:
        logger.exception("council_job failed for job %s", job_id_str)
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
