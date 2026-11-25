"""Aggregate all API routers into a single prefix-less router."""

from fastapi import APIRouter

from app.api.routes import account, automation, auth, chat, conversations, councils, documents, jobs, office, research, models

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(account.router)
api_router.include_router(models.router)
api_router.include_router(chat.router)
api_router.include_router(conversations.router)
api_router.include_router(councils.router)
api_router.include_router(jobs.router)
api_router.include_router(office.router)
api_router.include_router(research.router)
api_router.include_router(documents.router)
api_router.include_router(automation.router)
