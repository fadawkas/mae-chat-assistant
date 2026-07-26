import hashlib
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import COOKIE, CSRF_COOKIE, create_session, current_user, hash_password, verify_password, require_csrf
from app.core.config import settings
from app.core.database import get_db
from app.models import Session, User
from app.schemas import AuthResponse, SignInRequest, SignUpRequest, UserOut

router = APIRouter()

def _set_cookies(response: Response, token: str, csrf: str) -> None:
    response.set_cookie(COOKIE, token, httponly=True, secure=settings.cookie_secure, samesite="lax", max_age=settings.session_ttl_days * 86400)
    response.set_cookie(CSRF_COOKIE, csrf, httponly=False, secure=settings.cookie_secure, samesite="lax", max_age=settings.session_ttl_days * 86400)

@router.post("/api/auth/signup", response_model=AuthResponse, status_code=201)
async def signup(body: SignUpRequest, response: Response, db: AsyncSession = Depends(get_db)):
    email = body.email.strip().lower()
    if await db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Email already registered")
    user = User(first_name=body.first_name.strip(), last_name=body.last_name.strip(), email=email, password_hash=hash_password(body.password))
    db.add(user); await db.flush()
    token, csrf = await create_session(db, user)
    _set_cookies(response, token, csrf)
    return AuthResponse(user=UserOut.model_validate(user, from_attributes=True))

@router.post("/api/auth/signin", response_model=AuthResponse)
async def signin(body: SignInRequest, response: Response, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")
    token, csrf = await create_session(db, user); _set_cookies(response, token, csrf)
    return AuthResponse(user=UserOut.model_validate(user, from_attributes=True))

@router.post("/api/auth/signout", status_code=204, dependencies=[Depends(require_csrf)])
async def signout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    token = request.cookies.get(COOKIE)
    if token:
        session = await db.scalar(select(Session).where(Session.token_hash == hashlib.sha256(token.encode()).hexdigest()))
        if session: await db.delete(session); await db.commit()
    response.delete_cookie(COOKIE); response.delete_cookie(CSRF_COOKIE)

@router.get("/api/auth/me", response_model=UserOut)
async def me(user: User = Depends(current_user)): return UserOut.model_validate(user, from_attributes=True)
