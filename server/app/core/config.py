from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve .env relative to this file (server/app/core/config.py → server/.env)
_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Database ──────────────────────────────────────────────────────────
    DATABASE_URL: str

    # ── App ───────────────────────────────────────────────────────────────
    APP_ENV: str = "development"
    CORS_ORIGINS: str = "http://localhost:5173"

    # ── Auth / JWT ────────────────────────────────────────────────────────
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_EXPIRE_DAYS: int = 7

    # ── Default seed user (created on startup if DB is empty) ─────────────
    DEFAULT_USER_EMAIL: str
    DEFAULT_USER_PASSWORD: str
    DEFAULT_USER_NAME: str = "Admin"

    # ── LLM provider defaults ─────────────────────────────────────────────
    LLM_PROVIDER: str = "groq"
    LLM_MODEL: str = "llama-3.3-70b-versatile"
    LLM_TEMPERATURE: float = 0.7

    # ── LLM API keys (optional — falls back to mock if not set) ──────────
    GROQ_API_KEY: str | None = None
    OPENAI_API_KEY: str | None = None
    OPENROUTER_API_KEY: str | None = None

    # ── OpenRouter defaults ───────────────────────────────────────────────
    OPENROUTER_MODEL: str = "meta-llama/llama-3.3-70b-instruct:free"

    # ── Embeddings ────────────────────────────────────────────────────────
    # Provider: "openai" (uses text-embedding-3-small, dim=1536)
    #           "mock"   (all-zeros vector, for tests / offline dev)
    EMBEDDING_PROVIDER: str = "mock"
    EMBEDDING_MODEL: str = "text-embedding-3-small"   # used when EMBEDDING_PROVIDER=openai
    EMBEDDING_DIM: int = 1536                          # must match DocumentChunk.embedding Vector dim

    # ── File upload storage ───────────────────────────────────────────────
    # Local filesystem path for uploaded documents.
    # Swap this for an S3/GCS path prefix in production environments.
    UPLOAD_DIR: str = "uploads"

    def cors_origins_list(self) -> list[str]:
        """Split comma-separated CORS_ORIGINS into a list."""
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
