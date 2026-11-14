-- =====================================================================
-- Fluxo Inteligente · Spatial Analytics para shopping centers
-- Esquema relacional (SQLite 3.25+ no MVP; ver schema.postgres.sql)
--
-- Convenções
--   * Datas/horas em texto ISO-8601 no horário local do shopping
--     (America/Araguaina, UTC-3): 'YYYY-MM-DDTHH:MM:SS'.
--   * Coordenadas de zona em percentual (0–100) sobre a imagem do
--     pavimento, para o frontend posicionar o heatmap sem depender
--     da resolução da planta.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- Pavimentos da planta (Térreo, Piso 2 – Praça de Alimentação, ...)
CREATE TABLE IF NOT EXISTS floors (
    id           INTEGER PRIMARY KEY,
    code         TEXT    NOT NULL UNIQUE,          -- 'T', 'P2'
    name         TEXT    NOT NULL,
    level        INTEGER NOT NULL,                 -- ordem vertical
    plan_image   TEXT    NOT NULL,                 -- arquivo servido pelo frontend
    aspect_ratio REAL    NOT NULL                  -- largura / altura da imagem
);

-- Setores comerciais usados no cruzamento de tráfego
CREATE TABLE IF NOT EXISTS sectors (
    id    INTEGER PRIMARY KEY,
    code  TEXT NOT NULL UNIQUE,                    -- 'vestuario', 'alimentacao', ...
    name  TEXT NOT NULL,
    color TEXT NOT NULL                            -- cor no painel
);

-- Zonas monitoradas: lojas, praças, corredores e acessos
CREATE TABLE IF NOT EXISTS zones (
    id            INTEGER PRIMARY KEY,
    code          TEXT    NOT NULL UNIQUE,         -- 'T-CINEMARK'
    floor_id      INTEGER NOT NULL REFERENCES floors(id),
    sector_id     INTEGER NOT NULL REFERENCES sectors(id),
    name          TEXT    NOT NULL,
    store_ref     TEXT,                            -- referência na planta (ex.: 'LOJA 214')
    x_pct         REAL    NOT NULL CHECK (x_pct BETWEEN 0 AND 100),
    y_pct         REAL    NOT NULL CHECK (y_pct BETWEEN 0 AND 100),
    radius_pct    REAL    NOT NULL DEFAULT 4,      -- raio de influência no heatmap
    capacity_hour INTEGER NOT NULL CHECK (capacity_hour > 0), -- passagens/h confortáveis
    attractiveness REAL   NOT NULL DEFAULT 1,      -- peso usado pelo simulador
    is_entrance   INTEGER NOT NULL DEFAULT 0 CHECK (is_entrance IN (0, 1)),
    connects_to   TEXT                             -- code da zona ligada em outro piso (escadas/elevador)
);
CREATE INDEX IF NOT EXISTS ix_zones_floor ON zones(floor_id);

-- Câmeras existentes usadas como sensores de fluxo (integração Monuv)
CREATE TABLE IF NOT EXISTS cameras (
    id          INTEGER PRIMARY KEY,
    zone_id     INTEGER NOT NULL REFERENCES zones(id),
    external_id TEXT    NOT NULL UNIQUE,           -- id da câmera na plataforma de visão computacional
    name        TEXT    NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

-- Visitante anonimizado (nenhum dado pessoal: só o id de rastreio da visão computacional)
CREATE TABLE IF NOT EXISTS visitors (
    id         INTEGER PRIMARY KEY,
    track_id   TEXT NOT NULL UNIQUE,
    first_seen TEXT NOT NULL
);

-- Evento bruto de passagem: o visitante saiu de uma zona e entrou em outra
CREATE TABLE IF NOT EXISTS movement_events (
    id           INTEGER PRIMARY KEY,
    visitor_id   INTEGER NOT NULL REFERENCES visitors(id),
    from_zone_id INTEGER REFERENCES zones(id),     -- NULL = primeira detecção (entrada)
    to_zone_id   INTEGER NOT NULL REFERENCES zones(id),
    camera_id    INTEGER REFERENCES cameras(id),
    occurred_at  TEXT    NOT NULL,
    source       TEXT    NOT NULL DEFAULT 'api' CHECK (source IN ('api', 'simulator', 'monuv')),
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now')),
    CHECK (from_zone_id IS NULL OR from_zone_id <> to_zone_id)
);
CREATE INDEX IF NOT EXISTS ix_events_time        ON movement_events(occurred_at);
CREATE INDEX IF NOT EXISTS ix_events_visitor     ON movement_events(visitor_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_events_to_zone     ON movement_events(to_zone_id, occurred_at);

-- Agregado horário mantido na ingestão: base do mapa de calor
CREATE TABLE IF NOT EXISTS zone_hourly_stats (
    zone_id      INTEGER NOT NULL REFERENCES zones(id),
    bucket_start TEXT    NOT NULL,                 -- 'YYYY-MM-DDTHH:00:00'
    entries      INTEGER NOT NULL DEFAULT 0,       -- passagens (eventos com to_zone = zona)
    PRIMARY KEY (zone_id, bucket_start)
);
CREATE INDEX IF NOT EXISTS ix_stats_bucket ON zone_hourly_stats(bucket_start);

-- Equipe administrativa (Tela 1 – Autenticação)
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,                   -- pbkdf2_sha256$iter$salt$hash
    role          TEXT NOT NULL DEFAULT 'gestor' CHECK (role IN ('admin', 'gestor')),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now'))
);
