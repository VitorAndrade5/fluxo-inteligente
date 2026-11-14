"""Entrada do app na Vercel (preset "Python"): a Vercel procura `app` neste arquivo.

- A API FastAPI fica em backend/app; as rotas são /api/*.
- O painel (HTML/CSS/JS) fica em public/, servido pela CDN da Vercel
  (e também pelo próprio FastAPI, como reserva).
- Banco: PostgreSQL via DATABASE_URL (integração Neon). Sem ela, usa SQLite
  temporário em /tmp com dados simulados, só para demonstração.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from app.main import app  # noqa: E402,F401
