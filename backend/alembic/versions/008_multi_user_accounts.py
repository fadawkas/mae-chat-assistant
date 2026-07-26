"""Reset application data and add multi-user account ownership."""
from alembic import op
import sqlalchemy as sa

revision = "008_multi_user_accounts"
down_revision = "007"
branch_labels = None
depends_on = None

def upgrade() -> None:
    # Existing local data is intentionally discarded for the multi-user cutover.
    for table in ("document_artifacts", "messages", "jobs", "council_members", "councils", "automation_schedules", "conversations"):
        op.execute(sa.text(f"DELETE FROM {table}"))
    op.execute(sa.text("DROP TABLE IF EXISTS sessions CASCADE"))
    op.execute(sa.text("DROP TABLE IF EXISTS users CASCADE"))
    op.create_table("users",
        sa.Column("id", sa.UUID(), primary_key=True), sa.Column("first_name", sa.Text(), nullable=False),
        sa.Column("last_name", sa.Text(), nullable=False), sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text(), nullable=False), sa.Column("openrouter_key_encrypted", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_table("sessions",
        sa.Column("id", sa.UUID(), primary_key=True), sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False, unique=True), sa.Column("csrf_token", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    for table in ("conversations", "councils", "jobs", "automation_schedules"):
        op.execute(sa.text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS owner_id UUID"))
        op.execute(sa.text(f"ALTER TABLE {table} ADD CONSTRAINT {table}_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE"))

def downgrade() -> None:
    for table in ("automation_schedules", "jobs", "councils", "conversations"):
        op.execute(sa.text(f"ALTER TABLE {table} DROP COLUMN IF EXISTS owner_id"))
    op.drop_table("sessions")
    op.drop_table("users")
