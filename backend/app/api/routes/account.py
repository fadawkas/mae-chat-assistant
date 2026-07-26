from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user, encrypt_key, require_csrf
from app.core.database import get_db
from app.models import User
from app.schemas import OpenRouterKeyRequest, UserOut

router = APIRouter()

@router.put("/api/account/openrouter-key", response_model=UserOut, dependencies=[Depends(require_csrf)])
async def set_key(body: OpenRouterKeyRequest, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    user.openrouter_key_encrypted = encrypt_key(body.api_key.strip())
    await db.commit(); await db.refresh(user)
    return UserOut.model_validate(user, from_attributes=True)

@router.delete("/api/account/openrouter-key", response_model=UserOut, dependencies=[Depends(require_csrf)])
async def delete_key(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    user.openrouter_key_encrypted = None
    await db.commit(); await db.refresh(user)
    return UserOut.model_validate(user, from_attributes=True)
