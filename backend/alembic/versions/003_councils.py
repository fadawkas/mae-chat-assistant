"""Add councils + council_members tables, add council_id FK to jobs.

Revision ID: 003
Revises: 002
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "003"
down_revision: str | None = "002"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # councils
    op.create_table(
        "councils",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # council_members
    op.create_table(
        "council_members",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("council_id", UUID(as_uuid=True), sa.ForeignKey("councils.id", ondelete="CASCADE"), nullable=False),
        sa.Column("model", sa.Text, nullable=False),
        sa.Column("system_prompt", sa.Text, nullable=True),
        sa.Column("position", sa.Integer, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # add council_id FK to jobs
    op.add_column(
        "jobs",
        sa.Column("council_id", UUID(as_uuid=True), sa.ForeignKey("councils.id", ondelete="SET NULL"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("jobs", "council_id")
    op.drop_table("council_members")
    op.drop_table("councils")