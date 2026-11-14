"""Fluxo Inteligente · API REST (FastAPI).

Executar:  uvicorn app.main:app --reload   (dentro de backend/)
Docs:      http://localhost:8000/docs
Painel:    http://localhost:8000/        (serve ../frontend)
"""
import hmac
from contextlib import asynccontextmanager
from datetime import date, datetime

from fastapi import Depends, FastAPI, Header, HTTPException, Path, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import schemas
from .config import CLOSE_HOUR, FRONTEND_DIR, MALL_TZ, OPEN_HOUR, Settings, load_settings
from .database import Database, connect, get_db_factory, init_db
from .security import create_token, read_token, verify_password
from .services import analytics
from .services.ingest import IngestError, ZoneCache, record_event
from .services.simulator import simulate_day


def today() -> date:
    return datetime.now(MALL_TZ).date()


def ensure_today(settings: Settings) -> dict | None:
    """Simula o dia de hoje se ainda não houver eventos (dados de demonstração)."""
    conn = connect(settings.db_url)
    try:
        d = today()
        start, end = analytics.window(d, None)
        has = conn.execute("SELECT 1 AS ok FROM movement_events WHERE occurred_at >= ? AND occurred_at < ? LIMIT 1",
                           (start, end)).fetchone()
        if has:
            return None
        result = simulate_day(conn, d, settings.simulated_visitors)
        conn.commit()
        return result
    finally:
        conn.close()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    if settings.db_url.startswith("postgresql://"):
        insecure = [name for name, value, default in (
            ("FLUXO_SECRET_KEY", settings.secret_key, "dev-secret-troque-em-producao"),
            ("FLUXO_ADMIN_PASSWORD", settings.admin_password, "fluxo2026"),
            ("FLUXO_INGEST_KEY", settings.ingest_key, "dev-ingest-key"),
        ) if value in ("", default)]
        if insecure:
            raise RuntimeError("Produção (PostgreSQL) com valores padrão inseguros; defina: " + ", ".join(insecure))

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if settings.auto_simulate:
            init_db(settings)
            ensure_today(settings)
        yield

    app = FastAPI(
        title="Fluxo Inteligente API",
        version="0.1.0",
        description="Spatial Analytics para o Capim Dourado Shopping: mapa de calor e jornada de visitantes.",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    get_db = get_db_factory(settings)

    # ------------------------------------------------------------ auth
    def current_user(authorization: str | None = Header(default=None)) -> dict:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token ausente",
                                headers={"WWW-Authenticate": "Bearer"})
        data = read_token(authorization[7:].strip(), settings.secret_key)
        if not data:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token inválido ou expirado",
                                headers={"WWW-Authenticate": "Bearer"})
        return data

    def ingest_auth(x_api_key: str | None = Header(default=None),
                    authorization: str | None = Header(default=None)) -> None:
        """Câmeras/integrações usam X-API-Key; a equipe pode usar o token de login."""
        if x_api_key and x_api_key == settings.ingest_key:
            return
        current_user(authorization)

    def admin_only(user: dict = Depends(current_user)) -> dict:
        if user.get("role") != "admin":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "apenas administradores")
        return user

    def check_floor(floor: str) -> str:
        floor = floor.upper()
        if floor not in ("T", "P2"):
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"pavimento '{floor}' não existe")
        return floor


    @app.post("/api/auth/login", response_model=schemas.TokenOut, tags=["auth"])
    def login(body: schemas.LoginIn, db: Database = Depends(get_db)):
        row = db.execute("SELECT id, name, email, password_hash, role FROM users WHERE email = ?",
                         (body.email.strip().lower(),)).fetchone()
        if not row or not verify_password(body.password, row["password_hash"]):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "e-mail ou senha incorretos")
        token = create_token(row["id"], row["role"], settings.secret_key, settings.token_ttl_hours)
        return {"access_token": token, "user": {"id": row["id"], "name": row["name"],
                                                "email": row["email"], "role": row["role"]}}

    @app.get("/api/auth/me", tags=["auth"])
    def me(user: dict = Depends(current_user), db: Database = Depends(get_db)):
        row = db.execute("SELECT id, name, email, role FROM users WHERE id = ?", (user["sub"],)).fetchone()
        if not row:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "usuário removido")
        return dict(row)

    # ------------------------------------------------------- catálogo
    @app.get("/api/health", tags=["sistema"])
    def health(db: Database = Depends(get_db)):
        events = db.scalar("SELECT COUNT(*) AS n FROM movement_events")
        return {"status": "ok", "events": events, "database": db.dialect, "server_time": datetime.now(MALL_TZ).isoformat(timespec="seconds"),
                "opening_hours": [OPEN_HOUR, CLOSE_HOUR]}

    @app.get("/api/floors", tags=["catálogo"])
    def floors(_: dict = Depends(current_user), db: Database = Depends(get_db)):
        return [dict(r) for r in db.execute("SELECT code, name, level, plan_image, aspect_ratio FROM floors ORDER BY level")]

    @app.get("/api/sectors", tags=["catálogo"])
    def sectors(_: dict = Depends(current_user), db: Database = Depends(get_db)):
        return [dict(r) for r in db.execute("SELECT code, name, color FROM sectors ORDER BY id")]

    @app.get("/api/zones", tags=["catálogo"])
    def zones(floor: str | None = None, _: dict = Depends(current_user), db: Database = Depends(get_db)):
        sql = """SELECT z.code, f.code AS floor, s.code AS sector, z.name, z.store_ref, z.x_pct AS x, z.y_pct AS y,
                        z.radius_pct AS radius, z.capacity_hour, z.is_entrance, z.connects_to,
                        c.external_id AS camera_id
                 FROM zones z JOIN floors f ON f.id = z.floor_id JOIN sectors s ON s.id = z.sector_id
                 LEFT JOIN cameras c ON c.zone_id = z.id
                 WHERE (CAST(:floor AS TEXT) IS NULL OR f.code = :floor) ORDER BY f.level, z.code"""
        return [dict(r) for r in db.execute(sql, {"floor": check_floor(floor) if floor else None})]

    # -------------------------------------------------------- ingestão
    @app.post("/api/events", response_model=schemas.EventOut, status_code=status.HTTP_201_CREATED, tags=["ingestão"])
    def create_event(body: schemas.EventIn, _: None = Depends(ingest_auth), db: Database = Depends(get_db)):
        try:
            result = record_event(db, **body.model_dump())
        except IngestError as exc:
            db.rollback()
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from None
        db.commit()
        return result

    @app.post("/api/events/batch", response_model=schemas.BatchOut, status_code=status.HTTP_201_CREATED,
              tags=["ingestão"])
    def create_events(body: schemas.BatchIn, _: None = Depends(ingest_auth), db: Database = Depends(get_db)):
        cache = ZoneCache(db)
        out = []
        try:
            for i, ev in enumerate(sorted(body.events, key=lambda e: e.occurred_at)):
                try:
                    out.append(record_event(db, cache=cache, **ev.model_dump()))
                except IngestError as exc:
                    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"evento {i}: {exc}") from None
        except HTTPException:
            db.rollback()
            raise
        db.commit()
        return {"inserted": len(out), "events": out}

    @app.get("/api/visitors/{track_id}/journey", tags=["jornada"])
    def journey(track_id: str = Path(max_length=64), _: dict = Depends(current_user),
                db: Database = Depends(get_db)):
        steps = analytics.visitor_journey(db, track_id)
        if not steps:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "visitante sem eventos")
        return {"track_id": track_id, "steps": steps}

    # --------------------------------------------------- mapa de calor
    @app.get("/api/heatmap", response_model=schemas.HeatmapOut, tags=["mapa de calor"])
    def heatmap(floor: str = "T", day: date | None = Query(default=None, alias="date", description="AAAA-MM-DD; padrão: hoje"), hour: int | None = Query(default=None, ge=0, le=23, description="Hora cheia; omitida = dia inteiro"),
                _: dict = Depends(current_user), db: Database = Depends(get_db)):
        return analytics.heatmap(db, check_floor(floor), day or today(), hour)

    @app.get("/api/heatmap/timeline", tags=["mapa de calor"])
    def heatmap_timeline(day: date | None = Query(default=None, alias="date", description="AAAA-MM-DD; padrão: hoje"), floor: str | None = None,
                         _: dict = Depends(current_user), db: Database = Depends(get_db)):
        d = day or today()
        return {"date": d, "floor": floor, "hours": analytics.timeline(db, d, check_floor(floor) if floor else None)}

    @app.get("/api/metrics/summary", tags=["métricas"])
    def metrics_summary(day: date | None = Query(default=None, alias="date", description="AAAA-MM-DD; padrão: hoje"), hour: int | None = Query(default=None, ge=0, le=23, description="Hora cheia; omitida = dia inteiro"),
                        _: dict = Depends(current_user), db: Database = Depends(get_db)):
        return analytics.summary(db, day or today(), hour)

    @app.get("/api/metrics/dwell", tags=["métricas"])
    def metrics_dwell(day: date | None = Query(default=None, alias="date", description="AAAA-MM-DD; padrão: hoje"), floor: str | None = None,
                      _: dict = Depends(current_user), db: Database = Depends(get_db)):
        return analytics.zone_dwell(db, day or today(), check_floor(floor) if floor else None)

    @app.get("/api/metrics/dates", tags=["métricas"])
    def metrics_dates(_: dict = Depends(current_user), db: Database = Depends(get_db)):
        return analytics.dates_with_data(db)

    # ---------------------------------------------------------- jornada
    @app.get("/api/journeys/transitions", tags=["jornada"])
    def journeys_transitions(day: date | None = Query(default=None, alias="date", description="AAAA-MM-DD; padrão: hoje"), hour: int | None = Query(default=None, ge=0, le=23, description="Hora cheia; omitida = dia inteiro"),
                             from_zone: str | None = None, to_zone: str | None = None,
                             limit: int = Query(default=10, ge=1, le=100),
                             _: dict = Depends(current_user), db: Database = Depends(get_db)):
        return analytics.transitions(db, day or today(), hour,
                                     from_zone.upper() if from_zone else None,
                                     to_zone.upper() if to_zone else None, limit)

    @app.get("/api/journeys/sector-matrix", tags=["jornada"])
    def journeys_matrix(day: date | None = Query(default=None, alias="date", description="AAAA-MM-DD; padrão: hoje"), hour: int | None = Query(default=None, ge=0, le=23, description="Hora cheia; omitida = dia inteiro"),
                        _: dict = Depends(current_user), db: Database = Depends(get_db)):
        return analytics.sector_matrix(db, day or today(), hour)

    @app.get("/api/journeys/paths-to/{zone}", tags=["jornada"])
    def journeys_paths_to(zone: str, day: date | None = Query(default=None, alias="date", description="AAAA-MM-DD; padrão: hoje"), limit: int = Query(default=5, ge=1, le=20),
                          _: dict = Depends(current_user), db: Database = Depends(get_db)):
        try:
            return analytics.paths_to(db, zone.upper(), day or today(), limit)
        except LookupError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from None

    @app.get("/api/journeys/sector/{sector}", tags=["jornada"])
    def journeys_sector(sector: str, day: date | None = Query(default=None, alias="date", description="AAAA-MM-DD; padrão: hoje"), limit: int = Query(default=6, ge=1, le=20),
                        _: dict = Depends(current_user), db: Database = Depends(get_db)):
        try:
            return analytics.sector_flow(db, sector.lower(), day or today(), limit)
        except LookupError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from None

    # -------------------------------------------------------- simulação
    @app.post("/api/simulate", tags=["simulação"])
    def simulate(body: schemas.SimulateIn, _: dict = Depends(admin_only), db: Database = Depends(get_db)):
        result = simulate_day(db, body.date or today(), body.visitors, body.seed, body.replace)
        db.commit()
        return result

    @app.get("/api/cron/simulate", tags=["simulação"], include_in_schema=False)
    def cron_simulate(authorization: str | None = Header(default=None)):
        """Chamado pelo Vercel Cron (vercel.json) com `Authorization: Bearer $CRON_SECRET`."""
        expected = f"Bearer {settings.cron_secret}" if settings.cron_secret else None
        if not expected or not authorization or not hmac.compare_digest(authorization, expected):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "cron não autorizado")
        get_db_ready()
        return ensure_today(settings) or {"status": "dia já possui dados"}

    def get_db_ready():
        for _ in get_db():  # garante esquema e seed criados
            pass

    # painel estático (mesma origem que a API)
    if FRONTEND_DIR.exists():
        app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

    return app


app = create_app()
