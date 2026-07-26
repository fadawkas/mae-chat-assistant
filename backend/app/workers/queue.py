import json
import logging
from collections.abc import AsyncGenerator

import redis.asyncio as aioredis
from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from app.core.config import settings

logger = logging.getLogger("mae.queue")

# Progress pub/sub channel prefix.
PROGRESS_CHANNEL = "job:{}:progress"


def _progress_key(job_id: str) -> str:
    return PROGRESS_CHANNEL.format(job_id)


async def get_redis() -> aioredis.Redis:
    """Return a standalone async Redis connection (for pub/sub outside ARQ)."""
    return aioredis.from_url(settings.redis_url, decode_responses=True)


async def get_arq_redis() -> ArqRedis:
    """Return an ARQ Redis pool (for enqueuing jobs)."""
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    return await create_pool(redis_settings)


async def subscribe_progress(
    job_id: str,
) -> AsyncGenerator[dict, None]:
    """
    Async generator that subscribes to the progress pub/sub channel for a job.

    Yields parsed JSON events.  Catches ``asyncio.CancelledError`` so that
    the pub/sub connection is always cleaned up when the client disconnects.
    """
    r = await get_redis()
    pubsub = r.pubsub()
    try:
        await pubsub.subscribe(_progress_key(job_id))
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            try:
                yield json.loads(message["data"])
            except json.JSONDecodeError:
                logger.warning("unparseable progress message: %s", message["data"])
    finally:
        await pubsub.unsubscribe(_progress_key(job_id))
        await pubsub.close()
        await r.aclose()
