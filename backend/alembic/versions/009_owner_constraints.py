"""Make application-owned records require an owner."""
from alembic import op
import sqlalchemy as sa

revision = "009_owner_constraints"
down_revision = "008_multi_user_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("conversations", "councils", "jobs", "automation_schedules"):
        op.create_index(f"ix_{table}_owner_id", table, ["owner_id"], if_not_exists=True)
        op.alter_column(table, "owner_id", existing_type=sa.UUID(), nullable=False)


def downgrade() -> None:
    for table in ("automation_schedules", "jobs", "councils", "conversations"):
        op.alter_column(table, "owner_id", existing_type=sa.UUID(), nullable=True)
        op.drop_index(f"ix_{table}_owner_id", table_name=table)
