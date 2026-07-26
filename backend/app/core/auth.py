import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models import Session, User

COOKIE = "mae_session"
CSRF_COOKIE = "mae_csrf"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(digest).decode()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        _, salt, expected = encoded.split("$")
        actual = hashlib.scrypt(password.encode(), salt=base64.urlsafe_b64decode(salt), n=2**14, r=8, p=1)
        return hmac.compare_digest(actual, base64.urlsafe_b64decode(expected))
    except (ValueError, TypeError):
        return False


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.encryption_key.encode()).digest())
    return Fernet(key)


def encrypt_key(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_key(value: str) -> str:
    return _fernet().decrypt(value.encode()).decode()


async def current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    result = await db.execute(select(Session, User).join(User, User.id == Session.user_id).where(Session.token_hash == hashlib.sha256(token.encode()).hexdigest()))
    row = result.first()
    if not row or row.Session.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    return row.User

async def user_openrouter_key(user: User) -> str:
    if not user.openrouter_key_encrypted:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add an OpenRouter API key in account settings first")
    return decrypt_key(user.openrouter_key_encrypted)


async def require_csrf(request: Request) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    cookie = request.cookies.get(CSRF_COOKIE)
    header = request.headers.get("X-CSRF-Token")
    origin = request.headers.get("Origin")
    if origin and origin.rstrip("/") == str(request.base_url).rstrip("/"):
        return
    if not cookie or not header or not hmac.compare_digest(cookie, header):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF validation failed")


async def create_session(db: AsyncSession, user: User) -> tuple[str, str]:
    token, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
    db.add(Session(user_id=user.id, token_hash=hashlib.sha256(token.encode()).hexdigest(), csrf_token=csrf, expires_at=datetime.now(timezone.utc) + timedelta(days=settings.session_ttl_days)))
    await db.commit()
    return token, csrf
