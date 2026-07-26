import time
from redis.asyncio import Redis

from app.core.config import settings

_redis: Redis | None = None

async def check_rate_limit(key: str, limit: int, window: int = 60) -> tuple[bool, int]:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    bucket = f"mae:rate:{key}:{int(time.time()) // window}"
    count = await _redis.incr(bucket)
    if count == 1:
        await _redis.expire(bucket, window + 1)
    return count <= limit, max(1, window - int(time.time()) % window)
