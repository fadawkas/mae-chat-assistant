"""Council endpoints — enqueue jobs and CRUD saved configurations."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import async_session_factory
from app.core.auth import current_user, require_csrf
from app.models import Council, CouncilMember, Job, User
from app.workers.queue import get_arq_redis
from app.schemas import (
    CouncilConfigCreate,
    CouncilConfigDetail,
    CouncilConfigListItem,
    CouncilConfigMemberOut,
    CouncilRequest,
    JobEnqueueResponse,
)

router = APIRouter()


# ── Enqueue ──────────────────────────────────────────────────────────────────


@router.post("/api/council", response_model=JobEnqueueResponse, dependencies=[Depends(require_csrf)])
async def enqueue_council(body: CouncilRequest, user: User = Depends(current_user)):
    """Enqueue an LLM council job and return its ID.

    If ``council_id`` is provided, the member list and per-member
    ``system_prompt`` values are resolved from the saved configuration.
    Inline ``models`` / ``system_prompt`` are used as fallback only if no
    ``council_id`` is given.
    """
    job_id = uuid.uuid4()

    # If a saved council config is referenced, resolve its members now
    # and bake them into the job payload so the job is self-contained.
    models = body.models
    member_configs = None  # list of {"model": ..., "system_prompt": ...}

    judge_model = body.judge_model

    if body.council_id is not None:
        async with async_session_factory() as db:
            result = await db.execute(
                select(Council)
                .where(Council.id == body.council_id, Council.owner_id == user.id)
                .options(selectinload(Council.members))
            )
            council = result.scalar_one_or_none()
        if council is None:
            raise HTTPException(404, "Council not found")
        models = [m.model for m in council.members]
        member_configs = [
            {"id": str(m.id), "model": m.model, "system_prompt": m.system_prompt}
            for m in council.members
        ]
        # Use saved judge_model as fallback if not overridden in request.
        if judge_model is None and council.judge_model:
            judge_model = council.judge_model

    payload = {
        "prompt": body.prompt,
        "system_prompt": body.system_prompt,
        "models": models,
        "judge_model": judge_model,
        "council_id": str(body.council_id) if body.council_id else None,
        "member_configs": member_configs,
    }

    # Insert queued row
    async with async_session_factory() as db:
        db.add(Job(
            id=job_id,
            owner_id=user.id,
            type="council",
            status="queued",
            council_id=body.council_id,
            payload=payload,
        ))
        await db.commit()

    # Enqueue on ARQ
    arq_redis = await get_arq_redis()
    await arq_redis.enqueue_job("council_job", str(job_id), payload)
    await arq_redis.aclose()

    return JobEnqueueResponse(job_id=job_id)


# ── CRUD for saved council configurations ────────────────────────────────────


@router.post("/api/councils", response_model=CouncilConfigDetail, status_code=201, dependencies=[Depends(require_csrf)])
async def create_council(body: CouncilConfigCreate, user: User = Depends(current_user)):
    """Create a new council configuration with members."""
    async with async_session_factory() as db:
        council = Council(
            id=uuid.uuid4(),
            owner_id=user.id,
            name=body.name,
            description=body.description,
            judge_model=body.judge_model,
        )
        db.add(council)
        await db.flush()  # get the ID

        for i, m in enumerate(body.members):
            member = CouncilMember(
                id=uuid.uuid4(),
                council_id=council.id,
                model=m.model,
                system_prompt=m.system_prompt,
                position=i,
            )
            db.add(member)

        await db.commit()
        await db.refresh(council)

        # Reload with members
        result = await db.execute(
            select(Council)
            .where(Council.id == council.id)
            .options(selectinload(Council.members))
        )
        council = result.scalar_one()

        return _to_detail(council)


@router.get("/api/councils", response_model=list[CouncilConfigListItem])
async def list_councils(user: User = Depends(current_user)):
    """List all council configurations."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(Council).where(Council.owner_id == user.id).order_by(Council.created_at.desc())
        )
        councils = result.scalars().all()
        return [
            CouncilConfigListItem(
                id=c.id,
                name=c.name,
                description=c.description,
                judge_model=c.judge_model,
                created_at=c.created_at,
            )
            for c in councils
        ]


@router.get("/api/councils/{council_id}", response_model=CouncilConfigDetail)
async def get_council(council_id: uuid.UUID, user: User = Depends(current_user)):
    """Get a council configuration with its members."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(Council)
            .where(Council.id == council_id, Council.owner_id == user.id)
            .options(selectinload(Council.members))
        )
        council = result.scalar_one_or_none()

    if council is None:
        raise HTTPException(status_code=404, detail="Council not found")

    return _to_detail(council)


@router.put("/api/councils/{council_id}", response_model=CouncilConfigDetail, dependencies=[Depends(require_csrf)])
async def update_council(council_id: uuid.UUID, body: CouncilConfigCreate, user: User = Depends(current_user)):
    """Replace a council's metadata and members."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(Council)
            .where(Council.id == council_id, Council.owner_id == user.id)
            .options(selectinload(Council.members))
        )
        council = result.scalar_one_or_none()

        if council is None:
            raise HTTPException(status_code=404, detail="Council not found")

        council.name = body.name
        council.description = body.description
        council.judge_model = body.judge_model

        # Delete existing members (cascade handles DB, but ORM needs manual)
        for old_member in council.members:
            await db.delete(old_member)

        for i, m in enumerate(body.members):
            member = CouncilMember(
                id=uuid.uuid4(),
                council_id=council.id,
                model=m.model,
                system_prompt=m.system_prompt,
                position=i,
            )
            db.add(member)

        await db.commit()
        await db.refresh(council)

        # Reload
        result = await db.execute(
            select(Council)
            .where(Council.id == council.id)
            .options(selectinload(Council.members))
        )
        council = result.scalar_one()

        return _to_detail(council)


@router.delete("/api/councils/{council_id}", status_code=204, dependencies=[Depends(require_csrf)])
async def delete_council(council_id: uuid.UUID, user: User = Depends(current_user)):
    """Delete a council configuration (cascades to members)."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(Council).where(Council.id == council_id, Council.owner_id == user.id)
        )
        council = result.scalar_one_or_none()

        if council is None:
            raise HTTPException(status_code=404, detail="Council not found")

        await db.delete(council)
        await db.commit()


def _to_detail(council: Council) -> CouncilConfigDetail:
    return CouncilConfigDetail(
        id=council.id,
        name=council.name,
        description=council.description,
        judge_model=council.judge_model,
        created_at=council.created_at,
        members=[
            CouncilConfigMemberOut(
                id=m.id,
                model=m.model,
                system_prompt=m.system_prompt,
                position=m.position,
            )
            for m in council.members
        ],
    )
