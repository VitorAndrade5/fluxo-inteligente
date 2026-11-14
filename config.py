"""Configuração via variáveis de ambiente (valores padrão servem para desenvolvimento)."""
import os
from dataclasses import dataclass
from datetime import timedelta, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
SQL_DIR = BACKEND_DIR / "sql"
FRONTEND_DIR = BACKEND_DIR.parent / "frontend"

# America/Araguaina (Palmas-TO) não tem horário de verão: UTC-3 fixo.
MALL_TZ = timezone(timedelta(hours=-3), "America/Araguaina")
OPEN_HOUR = 10
CLOSE_HOUR = 22


def _flag(name: str, default: str) -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "sim"}


@dataclass(frozen=True)
class Settings:
    db_url: str
    secret_key: str
    ingest_key: str
    token_ttl_hours: int
    admin_email: str
    admin_password: str
    auto_simulate: bool
    simulated_visitors: int
    cors_origins: tuple[str, ...]
    cron_secret: str = ""


def _database_url() -> str:
    """PostgreSQL se houver DATABASE_URL (Neon/Vercel injeta) ou POSTGRES_URL; senão SQLite local."""
    for name in ("DATABASE_URL", "POSTGRES_URL"):
        url = os.getenv(name, "").strip()
        if url:
            return url.replace("postgres://", "postgresql://", 1)
    return "sqlite:///" + os.getenv("FLUXO_DB_PATH", str(BACKEND_DIR / "fluxo.db"))


def load_settings() -> Settings:
    return Settings(
        db_url=_database_url(),
        secret_key=os.getenv("FLUXO_SECRET_KEY", "dev-secret-troque-em-producao"),
        ingest_key=os.getenv("FLUXO_INGEST_KEY", "dev-ingest-key"),
        token_ttl_hours=int(os.getenv("FLUXO_TOKEN_TTL_HOURS", "12")),
        admin_email=os.getenv("FLUXO_ADMIN_EMAIL", "admin@capimdourado.com.br"),
        admin_password=os.getenv("FLUXO_ADMIN_PASSWORD", "fluxo2026"),
        auto_simulate=_flag("FLUXO_AUTO_SIMULATE", "1"),
        simulated_visitors=int(os.getenv("FLUXO_SIMULATED_VISITORS", "3000")),
        cron_secret=os.getenv("CRON_SECRET", ""),
        cors_origins=tuple(
            o.strip() for o in os.getenv("FLUXO_CORS_ORIGINS", "*").split(",") if o.strip()
        ),
    )
