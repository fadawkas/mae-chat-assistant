"""Add title column to jobs table.

Revision ID: 004
Revises: 003
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "004"
down_revision: str | None = "003"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("title", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("jobs", "title")