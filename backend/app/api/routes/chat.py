import asyncio
import json
import traceback
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.core.database import async_session_factory
from app.models import Conversation, Message
from app.schemas import ChatRequest
from app.core.auth import current_user, user_openrouter_key
from app.models import User
# titling import removed - handled inline in _stream_and_persist

router = APIRouter()


def _make_event(type_: str, **extra: object) -> str:
    """Build a JSON-encoded SSE data frame."""
    payload: dict[str, object] = {"type": type_, **extra}
    return f"data: {json.dumps(payload)}\n\n"


async def _stream_and_persist(
    request: ChatRequest,
    conv_id: UUID,
    api_key: str,
    owner_id: UUID,
):
    """SSE generator that streams tokens and persists messages."""
    from app.main import app  # late import avoids circularity

    from app.services.openrouter import OpenRouterClient
    client = OpenRouterClient(api_key)
    messages = [m.model_dump() for m in request.messages]

    # Open one session for the entire streaming lifecycle.
    async with async_session_factory() as db:
        # Persist user message before streaming
        if request.messages:
            last = request.messages[-1]
            db.add(Message(
                conversation_id=conv_id,
                role=last.role,
                content=last.content,
            ))
            await db.commit()

        try:
            full_content = ""
            async for token in client.stream(request.model, messages):
                full_content += token
                yield _make_event("token", text=token)

            # Persist assistant response
            db.add(Message(
                conversation_id=conv_id,
                role="assistant",
                content=full_content,
                model=request.model,
            ))
            await db.commit()

            # Auto-title from first user message if still default
            first_user = request.messages[0].content if request.messages else ""
            result = await db.execute(
                select(Conversation).where(Conversation.id == conv_id, Conversation.owner_id == owner_id)
            )
            conv = result.scalar_one()
            if conv.title == "New Chat" and first_user:
                # Generate LLM title synchronously (blocks briefly but ensures it completes)
                from app.services.titling import generate_title
                llm_title = await generate_title(first_user, kind="chat")
                if llm_title:
                    conv.title = llm_title
                else:
                    # Fallback to truncated user message if LLM fails
                    conv.title = first_user[:80]
                await db.commit()

            yield _make_event("done", conversation_id=str(conv_id))

        except Exception:
            yield _make_event("error", message=traceback.format_exc())


async def _stream_only(request: ChatRequest):
    """SSE generator for one-off chat (no persistence)."""
    from app.main import app

    client = app.state.openrouter_client
    messages = [m.model_dump() for m in request.messages]

    try:
        async for token in client.stream(request.model, messages):
            yield _make_event("token", text=token)
        yield _make_event("done")
    except Exception:
        yield _make_event("error", message=traceback.format_exc())


@router.post("/api/chat")
async def chat(request: ChatRequest, user: User = Depends(current_user)):
    """Stream a chat-completion response via Server-Sent Events.

    If ``conversation_id`` is provided, messages are persisted to the
    database.  If no ``conversation_id`` is given, the request is treated
    as a one-off (no persistence).

    When a ``conversation_id`` is given but the conversation doesn't exist
    yet, one is created on the fly (useful for client-assigned UUIDs).
    """
    conv_id: UUID | None = request.conversation_id

    if conv_id is not None:
        # Ensure the conversation exists
        async with async_session_factory() as db:
            result = await db.execute(
                select(Conversation).where(Conversation.id == conv_id, Conversation.owner_id == user.id)
            )
            if result.scalar_one_or_none() is None:
                db.add(Conversation(id=conv_id, owner_id=user.id))
                await db.commit()

        generator = _stream_and_persist(request, conv_id, await user_openrouter_key(user), user.id)
    else:
        from app.services.openrouter import OpenRouterClient
        async def stream_for_user():
            client = OpenRouterClient(await user_openrouter_key(user))
            try:
                async for token in client.stream(request.model, [m.model_dump() for m in request.messages]):
                    yield _make_event("token", text=token)
                yield _make_event("done")
            except Exception as exc:
                yield _make_event("error", message=str(exc))
        generator = stream_for_user()

    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
        },
    )
