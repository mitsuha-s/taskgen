import os
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Config:
    APP_ENV = os.getenv("APP_ENV", "local")
    DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "postgresql://app:app@127.0.0.1:55432/variantor",
    )
    MIGRATIONS_DIR = os.getenv("MIGRATIONS_DIR", str(BASE_DIR / "migrations"))
    PROMPTS_DIR = os.getenv(
        "PROMPTS_DIR",
        str(BASE_DIR / "prompts" / "task_processing_pipeline_v1"),
    )
    AUTH_EMAIL = os.getenv("AUTH_EMAIL", "teacher@example.com")
    AUTH_PASSWORD = os.getenv("AUTH_PASSWORD", "secret")
    PUBLIC_FILE_BASE_URL = os.getenv("PUBLIC_FILE_BASE_URL", "/api/files").rstrip("/")
    FILE_STORAGE_DIR = os.getenv("FILE_STORAGE_DIR", str(BASE_DIR / "storage" / "uploads"))
    MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
    MAX_VARIANT_COUNT = int(os.getenv("MAX_VARIANT_COUNT", "10"))
    ALLOWED_UPLOAD_EXTENSIONS = {
        item.strip().lower()
        for item in os.getenv(
            "ALLOWED_UPLOAD_EXTENSIONS",
            ".png,.jpg,.jpeg,.webp",
        ).split(",")
        if item.strip()
    }
    CORS_ALLOWED_ORIGINS = [
        item.strip()
        for item in os.getenv(
            "CORS_ALLOWED_ORIGIN",
            "http://127.0.0.1:5173,http://localhost:5173",
        ).split(",")
        if item.strip()
    ]

    LLM_PROVIDER = os.getenv("LLM_PROVIDER", "mock").strip().lower()
    GIGACHAT_AUTH_KEY = os.getenv("GIGACHAT_AUTH_KEY", "")
    GIGACHAT_MODEL = os.getenv("GIGACHAT_MODEL", "GigaChat-Pro")
    GIGACHAT_TEXT_MODEL = os.getenv("GIGACHAT_TEXT_MODEL", "")
    GIGACHAT_SCOPE = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
    GIGACHAT_AUTH_URL = os.getenv(
        "GIGACHAT_AUTH_URL",
        "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    )
    GIGACHAT_API_BASE_URL = os.getenv(
        "GIGACHAT_API_BASE_URL",
        os.getenv("GIGACHAT_API_URL", "https://gigachat.devices.sberbank.ru/api/v1"),
    )
    GIGACHAT_VERIFY_TLS = os.getenv("GIGACHAT_VERIFY_TLS", "true").lower() in {
        "1",
        "true",
        "yes",
    }
    GIGACHAT_TIMEOUT = int(os.getenv("GIGACHAT_TIMEOUT", "90"))

    @property
    def COOKIE_SECURE(self) -> bool:
        cookie_secure = os.getenv("COOKIE_SECURE")
        if cookie_secure is not None:
            return cookie_secure.lower() in {"1", "true", "yes"}
        return self.APP_ENV != "local"
