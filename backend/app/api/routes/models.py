from fastapi import APIRouter, Depends
from app.core.auth import current_user, user_openrouter_key
from app.models import User
from app.schemas import ModelOut
from app.services.openrouter import OpenRouterClient

router = APIRouter()

@router.get("/api/models", response_model=list[ModelOut])
async def list_models(user: User = Depends(current_user)):
    client = OpenRouterClient(await user_openrouter_key(user))
    return await client.models()
