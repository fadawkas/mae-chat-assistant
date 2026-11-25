from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MAE_", env_file=".env")

    # OpenRouter
    openrouter_api_key: str = "sk-or-v1-placeholder"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    default_model: str = "openai/gpt-4o"
    council_models: str = "openai/gpt-4o,deepseek/deepseek-v4-flash"

    # Council
    council_timeout_seconds: int = 60

    # Titling
    titling_model: str = "openrouter/free"

    # Search
    search_api_key: str = ""
    search_base_url: str = "https://api.tavily.com"

    # Database
    database_url: str = "postgresql+asyncpg://mae:mae@postgres:5432/mae"

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # Output
    output_dir: str = "/data/outputs"
    upload_dir: str = "/data/uploads"
    max_upload_bytes: int = 10 * 1024 * 1024
    sandbox_url: str = "http://mae-sandbox:9000"
    code_runner_url: str = "http://mae-code:9200"
    office_public_url: str = ""
    office_internal_url: str = "http://mae-office"
    office_mae_url: str = "http://mae-api:8000"
    office_jwt_secret: str = ""
    renderer_url: str = "http://mae-renderer:9100"
    document_agent_model: str = "openai/gpt-4o"  # Legacy environment compatibility.
    sandbox_timeout_seconds: int = 90
    document_max_attempts: int = 3
    encryption_key: str = "change-me-in-production"
    session_ttl_days: int = 30
    cookie_secure: bool = False
    rate_limit_per_minute: int = 60


settings = Settings()
