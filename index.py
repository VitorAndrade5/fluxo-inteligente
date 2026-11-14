"""Entrada da função serverless da Vercel: expõe a API FastAPI de backend/app.

O vercel.json reescreve /api/* para esta função; o frontend estático sai de
frontend/. Configure as variáveis de ambiente descritas no README (DATABASE_URL
vem da integração Neon do Marketplace da Vercel).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.main import app  # noqa: E402,F401
