"""Carrega as consultas nomeadas de sql/queries.sql (fonte única do SQL de relatórios)."""
import re
from functools import lru_cache

from .config import SQL_DIR

_NAME = re.compile(r"^--\s*name:\s*([\w@]+)\s*$", re.MULTILINE)


@lru_cache(maxsize=1)
def _load() -> dict[str, str]:
    text = (SQL_DIR / "queries.sql").read_text(encoding="utf-8")
    parts = _NAME.split(text)
    # parts = [preâmbulo, nome1, sql1, nome2, sql2, ...]
    queries = {}
    for name, body in zip(parts[1::2], parts[2::2]):
        lines = [l for l in body.strip().splitlines() if not l.lstrip().startswith("--")]
        queries[name] = "\n".join(lines).strip().rstrip(";")
    return queries


def q(name: str, dialect: str = "sqlite") -> str:
    """Consulta nomeada; `nome@postgres` sobrescreve a versão padrão no PostgreSQL."""
    queries = _load()
    if dialect != "sqlite" and f"{name}@{dialect}" in queries:
        return queries[f"{name}@{dialect}"]
    try:
        return queries[name]
    except KeyError as exc:  # pragma: no cover - erro de programação
        raise KeyError(f"consulta '{name}' não existe em queries.sql") from exc
