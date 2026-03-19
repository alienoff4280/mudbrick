"""
Mudbrick v2 -- Application Configuration
Reads settings from environment variables with sensible defaults for local dev.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # "local" uses filesystem adapters; "production" uses Vercel Blob/KV
    environment: str = "local"

    # Local development: directory for session file storage
    data_dir: str = "./data"

    # Vercel Blob (production)
    blob_read_write_token: str = ""

    # Vercel KV / Redis (production)
    kv_rest_api_url: str = ""
    kv_rest_api_token: str = ""

    # OCR
    tesseract_cmd: str = "tesseract"

    # Server
    api_port: int = 8000

    # Session
    max_versions: int = 20
    session_ttl_hours: int = 24

    model_config = {
        "env_prefix": "MUDBRICK_",
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
