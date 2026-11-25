"""Link chat messages to saved artifact runs."""

from alembic import op
import sqlalchemy as sa

revision = "010_message_artifact_run"
down_revision = "009_owner_constraints"


def upgrade():
    op.add_column("messages", sa.Column("artifact_run_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_messages_artifact_run_id", "messages", "jobs",
        ["artifact_run_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_messages_artifact_run_id", "messages", ["artifact_run_id"])


def downgrade():
    op.drop_index("ix_messages_artifact_run_id", table_name="messages")
    op.drop_constraint("fk_messages_artifact_run_id", "messages", type_="foreignkey")
    op.drop_column("messages", "artifact_run_id")
