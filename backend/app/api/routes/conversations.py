from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.models import Conversation
from app.schemas import (
    ConversationCreateResponse,
    ConversationDetail,
    ConversationListItem,
    ConversationRenameRequest,
    MessageOut,
)
from app.core.auth import current_user
from app.models import User

router = APIRouter()


@router.post("/api/conversations", response_model=ConversationCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_conversation(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """Create a new conversation. Returns the conversation id for use in /api/chat."""
    conv = Conversation(owner_id=user.id)
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return ConversationCreateResponse(
        id=conv.id,
        title=conv.title,
        created_at=conv.created_at,
    )


@router.get("/api/conversations", response_model=list[ConversationListItem])
async def list_conversations(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """List all conversations, most recent first."""
    result = await db.execute(
        select(Conversation).where(Conversation.owner_id == user.id).order_by(Conversation.created_at.desc())
    )
    convs = result.scalars().all()
    return [
        ConversationListItem(id=c.id, title=c.title, created_at=c.created_at)
        for c in convs
    ]


@router.patch("/api/conversations/{conversation_id}", response_model=ConversationListItem)
async def rename_conversation(conversation_id: UUID, body: ConversationRenameRequest, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """Rename a conversation."""
    result = await db.execute(select(Conversation).where(Conversation.id == conversation_id, Conversation.owner_id == user.id))
    conv = result.scalar_one_or_none()
    if conv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    conv.title = body.title
    await db.commit()
    await db.refresh(conv)
    return ConversationListItem(id=conv.id, title=conv.title, created_at=conv.created_at)


@router.delete("/api/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(conversation_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """Delete a conversation and its messages (CASCADE)."""
    result = await db.execute(select(Conversation).where(Conversation.id == conversation_id, Conversation.owner_id == user.id))
    conv = result.scalar_one_or_none()
    if conv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    await db.delete(conv)
    await db.commit()


@router.get("/api/conversations/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(conversation_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """Get a conversation with its full message history."""
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conversation_id, Conversation.owner_id == user.id)
        .options(joinedload(Conversation.messages))
    )
    conv = result.unique().scalar_one_or_none()
    if conv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    return ConversationDetail(
        id=conv.id,
        title=conv.title,
        created_at=conv.created_at,
        messages=[
            MessageOut(
                id=m.id,
                role=m.role,
                content=m.content,
                model=m.model,
                created_at=m.created_at,
            )
            for m in conv.messages
        ],
    )
