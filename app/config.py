from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "agentic_dashboard"
    model_name: str = "gemini-3-flash-preview"
    registry_db: Path = Path("data/dashboard.db")
    allow_private_agents: bool = False
    agent_timeout_seconds: float = 20.0
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def allowed_origins(self) -> list[str]:
        return [
            value.strip() for value in self.cors_origins.split(",") if value.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
