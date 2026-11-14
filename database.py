"""Acesso ao banco: SQLite (desenvolvimento) ou PostgreSQL (produção / Vercel + Neon).

O resto do código escreve SQL com parâmetros nomeados (`:nome`) ou posicionais
(`?`); no PostgreSQL eles são traduzidos para o formato do psycopg.
"""
import re
import sqlite3
import threading
from collections.abc import Iterable, Iterator, Sequence

from .config import SQL_DIR, Settings
from .security import hash_password

_NAMED = re.compile(r"(?<![:\w]):([A-Za-z_]\w*)")
TABLES = ("zone_hourly_stats", "movement_events", "visitors", "cameras", "zones", "sectors", "floors", "users")


class Database:
    """Conexão fina sobre sqlite3 / psycopg com a mesma interface."""

    def __init__(self, url: str):
        self.url = url
        self.dialect = "postgres" if url.startswith(("postgres://", "postgresql://")) else "sqlite"
        if self.dialect == "postgres":
            import psycopg
            from psycopg.rows import dict_row

            # prepare_threshold=None: compatível com o pooler do Neon (PgBouncer em modo transação)
            self.conn = psycopg.connect(url, row_factory=dict_row, prepare_threshold=None)
        else:
            path = url.removeprefix("sqlite:///")
            self.conn = sqlite3.connect(path, check_same_thread=False, timeout=15)
            self.conn.row_factory = sqlite3.Row
            self.conn.execute("PRAGMA foreign_keys = ON")
            self.conn.execute("PRAGMA journal_mode = WAL")

    # ------------------------------------------------------------------ SQL
    def _sql(self, sql: str) -> str:
        if self.dialect == "postgres":
            return _NAMED.sub(r"%(\1)s", sql).replace("?", "%s")
        return sql

    def execute(self, sql: str, params: dict | Sequence | None = None):
        return self.conn.execute(self._sql(sql), params if params is not None else ())

    def scalar(self, sql: str, params: dict | Sequence | None = None):
        row = self.execute(sql, params).fetchone()
        return None if row is None else list(dict(row).values())[0]

    def executescript(self, script: str) -> None:
        if self.dialect == "postgres":
            self.conn.execute(script)
        else:
            self.conn.executescript(script)

    def bulk_insert(self, table: str, columns: Sequence[str], rows: Iterable[Sequence]) -> None:
        """Carga em massa: COPY no PostgreSQL, executemany no SQLite."""
        cols = ", ".join(columns)
        if self.dialect == "postgres":
            with self.conn.cursor() as cur, cur.copy(f"COPY {table} ({cols}) FROM STDIN") as copy:
                for row in rows:
                    copy.write_row(row)
        else:
            marks = ", ".join("?" for _ in columns)
            self.conn.executemany(f"INSERT INTO {table} ({cols}) VALUES ({marks})", rows)

    def table_exists(self, name: str) -> bool:
        if self.dialect == "postgres":
            return bool(self.scalar("SELECT to_regclass(:n) IS NOT NULL AS ok", {"n": name}))
        return bool(self.scalar("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=:n", {"n": name}))

    def commit(self) -> None:
        self.conn.commit()

    def rollback(self) -> None:
        self.conn.rollback()

    def close(self) -> None:
        self.conn.close()


def connect(url: str) -> Database:
    return Database(url)


def init_db(settings: Settings) -> None:
    """Cria esquema, carrega o seed e o usuário admin quando o banco está vazio (idempotente)."""
    db = connect(settings.db_url)
    try:
        if not db.table_exists("users"):
            schema = "schema.postgres.sql" if db.dialect == "postgres" else "schema.sql"
            db.executescript((SQL_DIR / schema).read_text(encoding="utf-8"))
        if not db.scalar("SELECT COUNT(*) AS n FROM floors"):
            db.executescript((SQL_DIR / "seed.sql").read_text(encoding="utf-8"))
        if not db.scalar("SELECT COUNT(*) AS n FROM users"):
            db.execute(
                "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
                ("Operações Capim Dourado", settings.admin_email.lower(), hash_password(settings.admin_password)),
            )
        db.commit()
    finally:
        db.close()


def drop_all(db: Database) -> None:
    """Apaga todas as tabelas (usado pelos testes)."""
    for table in TABLES:
        db.execute(f"DROP TABLE IF EXISTS {table}" + (" CASCADE" if db.dialect == "postgres" else ""))
    db.commit()


def get_db_factory(settings: Settings):
    lock = threading.Lock()
    ready = {"done": False}

    def get_db() -> Iterator[Database]:
        # inicialização preguiçosa: funções serverless nem sempre executam o lifespan
        if not ready["done"]:
            with lock:
                if not ready["done"]:
                    init_db(settings)
                    ready["done"] = True
        db = connect(settings.db_url)
        try:
            yield db
        finally:
            db.close()

    return get_db
