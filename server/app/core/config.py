from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Database ──────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/agora"

    # ── LLM — provider selection ─────────────────────────────────────────
    # Options: "groq" | "openai" | "mock"
    # Default is "mock" so the app runs without any API key configured.
    LLM_PROVIDER: str = "mock"

    # Model name sent to the active provider (e.g. llama-3.3-70b-versatile for Groq)
    LLM_MODEL: str = "llama-3.3-70b-versatile"
    LLM_TEMPERATURE: float = 0.7

    # ── LLM — provider credentials ───────────────────────────────────────
    GROQ_API_KEY: str = ""
    OPENAI_API_KEY: str = ""

    # ── App ───────────────────────────────────────────────────────────────
    APP_ENV: str = "development"
    # ── Auth / JWT ────────────────────────────────────────────────────
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_EXPIRE_DAYS: int = 7

@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
