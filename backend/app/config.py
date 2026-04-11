from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    SECRET_KEY: str = "change-me-to-random-string"
    ADMIN_USER: str = "admin"
    ADMIN_PASS: str = "admin"

    DATA_DIR: str = "./data"
    DB_PATH: str = "./data/just-wiki.db"
    MEDIA_DIR: str = "./data/media"

    VITE_API_URL: str = "http://localhost:8000"
    COOKIE_SECURE: bool = False  # Set to True in production with HTTPS

    AI_ENABLED: bool = False
    GEMINI_API_KEY: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()

# Ensure directories exist
Path(settings.DATA_DIR).mkdir(parents=True, exist_ok=True)
Path(settings.MEDIA_DIR).mkdir(parents=True, exist_ok=True)
