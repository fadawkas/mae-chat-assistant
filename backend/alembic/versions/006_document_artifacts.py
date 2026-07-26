"""Store durable document input/output artifact metadata."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "document_artifacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("storage_name", sa.Text(), nullable=False),
        sa.Column("original_name", sa.Text()),
        sa.Column("content_type", sa.Text()),
        sa.Column("format", sa.Text(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_document_artifacts_job_id", "document_artifacts", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_document_artifacts_job_id", table_name="document_artifacts")
    op.drop_table("document_artifacts")
