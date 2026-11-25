"""A one-run, one-upload grant for a user-selected browser tab."""

import hashlib
import hmac
from secrets import token_urlsafe
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl, StringConstraints, field_validator
from sqlalchemy import select

from app.models import Job

Cell = Annotated[str, StringConstraints(max_length=256)]
Row = Annotated[list[Cell], Field(min_length=1, max_length=20)]


class BrowserTable(BaseModel):
    url: HttpUrl
    title: str = Field(max_length=200)
    rows: list[Row] = Field(min_length=2, max_length=151)

    @field_validator("rows")
    @classmethod
    def limit_rows(cls, rows: list[list[str]]) -> list[list[str]]:
        if sum(len(cell.encode("utf-8")) + 4 for row in rows for cell in row) > 32_000:
            raise ValueError("Selected table exceeds the 32 KB capture limit")
        return rows

    def observation(self) -> dict:
        # Query strings and fragments can contain credentials or tracking IDs.
        authority = self.url.host or ""
        if self.url.port and self.url.port not in (80, 443):
            authority += f":{self.url.port}"
        return {"source": f"{self.url.scheme}://{authority}{self.url.path or '/'}",
                "title": self.title, "rows": self.rows}


def new_grant(run_id: UUID) -> tuple[str, str]:
    secret = token_urlsafe(32)
    return f"{run_id}.{secret}", hashlib.sha256(secret.encode()).hexdigest()


def grant_matches(run_id: UUID, authorization: str, expected: str) -> bool:
    prefix = f"Bearer {run_id}."
    if not expected or not authorization.startswith(prefix) or len(authorization) != len(prefix) + 43:
        return False
    return hmac.compare_digest(expected, hashlib.sha256(authorization[len(prefix):].encode()).hexdigest())


def browser_run(run_id: UUID):
    return select(Job).where(Job.id == run_id, Job.type == "chat").with_for_update()
