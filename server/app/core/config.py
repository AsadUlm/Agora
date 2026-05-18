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
    LLM_PROVIDER: str = "openrouter"
    LLM_MODEL: str = "anthropic/claude-sonnet-4.5"
    LLM_TEMPERATURE: float = 0.7
    LLM_MAX_CONCURRENT_AGENT_CALLS: int = 3

    # ── LLM API keys (optional — server starts without them, falls back to mock)
    GROQ_API_KEY: str | None = None
    OPENAI_API_KEY: str | None = None
    OPENROUTER_API_KEY: str | None = None
    GEMINI_API_KEY: str | None = None

    # ── OpenRouter defaults ───────────────────────────────────────────────
    OPENROUTER_MODEL: str = "anthropic/claude-sonnet-4.5"
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    # Optional attribution headers for OpenRouter (HTTP-Referer / X-Title)
    OPENROUTER_SITE_URL: str | None = None
    OPENROUTER_APP_NAME: str | None = "AGORA"

    # ── Embeddings ────────────────────────────────────────────────────────
    # Provider:
    #   "openrouter" — POST {OPENROUTER_BASE_URL}/embeddings (recommended)
    #   "openai"     — direct OpenAI text-embedding-3-small (needs OPENAI_API_KEY)
    #   "mock"       — all-zeros vector, for tests / offline dev
    # NOTE: leaving the default at "mock" keeps local startup safe; flip to
    # "openrouter" via .env for real RAG quality.
    EMBEDDING_PROVIDER: str = "mock"
    EMBEDDING_MODEL: str = "google/gemini-embedding-exp-03-07"
    EMBEDDING_DIM: int = 768                           # must match DocumentChunk.embedding Vector dim

    # ── File upload storage ───────────────────────────────────────────────
    # Local filesystem path for uploaded documents.
    # Swap this for an S3/GCS path prefix in production environments.
    UPLOAD_DIR: str = "uploads"

    # ── Document storage provider (Step 30) ──────────────────────────────
    # "local"      — write to UPLOAD_DIR (dev/test default).
    # "cloudinary" — upload to Cloudinary as resource_type='raw'. Requires
    #                CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET below.
    DOCUMENT_STORAGE_PROVIDER: str = "local"

    # Per-file size cap (MB) for the upload pipeline.
    DOCUMENT_MAX_FILE_SIZE_MB: int = 20
    # Max number of files accepted in one multi-upload request.
    DOCUMENT_MAX_FILES_PER_UPLOAD: int = 10

    # ── Cloudinary credentials (only read when provider == "cloudinary") ─
    CLOUDINARY_CLOUD_NAME: str | None = None
    CLOUDINARY_API_KEY: str | None = None
    CLOUDINARY_API_SECRET: str | None = None
    CLOUDINARY_UPLOAD_FOLDER: str = "agora/documents"
    CLOUDINARY_RESOURCE_TYPE: str = "raw"

    def cors_origins_list(self) -> list[str]:
        """Split comma-separated CORS_ORIGINS into a list."""
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
