"""Rename skill jobs to document jobs.

Revision ID: 005
Revises: 004
"""
from alembic import op

revision: str = "005"
down_revision: str | None = "004"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.execute("UPDATE jobs SET type = 'document' WHERE type = 'skill'")


def downgrade() -> None:
    op.execute("UPDATE jobs SET type = 'skill' WHERE type = 'document'")
