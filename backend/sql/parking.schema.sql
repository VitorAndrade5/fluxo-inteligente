-- =====================================================================
-- Fluxo Inteligente · estacionamento inteligente (SQLite)
-- Cada vaga tem um estado livre/ocupada informado por câmera (visão
-- computacional) ou sensor; o painel pinta a vaga de verde ou vermelho.
-- Variante PostgreSQL: parking.schema.postgres.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS parking_lots (
    id          INTEGER PRIMARY KEY,
    code        TEXT    NOT NULL UNIQUE,          -- 'S1', 'S2', 'TN', 'TS'
    name        TEXT    NOT NULL,
    level_label TEXT    NOT NULL,                 -- 'Subsolo 1', 'Térreo'
    total       INTEGER NOT NULL CHECK (total > 0),
    rows_count  INTEGER NOT NULL,                 -- layout esquemático do painel
    cols_count  INTEGER NOT NULL,
    is_estimate INTEGER NOT NULL DEFAULT 0 CHECK (is_estimate IN (0, 1)), -- 1 = nº de vagas não consta na planta
    preference  REAL    NOT NULL DEFAULT 1        -- peso usado pelo simulador
);

CREATE TABLE IF NOT EXISTS parking_spaces (
    id      INTEGER PRIMARY KEY,
    lot_id  INTEGER NOT NULL REFERENCES parking_lots(id),
    code    TEXT    NOT NULL UNIQUE,              -- 'S1-A01'
    row_idx INTEGER NOT NULL,
    col_idx INTEGER NOT NULL,
    kind    TEXT    NOT NULL DEFAULT 'comum'
            CHECK (kind IN ('comum', 'pne', 'idoso', 'neurodiverso', 'gestante'))
);
CREATE INDEX IF NOT EXISTS ix_spaces_lot ON parking_spaces(lot_id);

-- Mudança de estado de uma vaga (histórico completo; o estado atual é o último evento)
CREATE TABLE IF NOT EXISTS parking_events (
    id          INTEGER PRIMARY KEY,
    space_id    INTEGER NOT NULL REFERENCES parking_spaces(id),
    occupied    INTEGER NOT NULL CHECK (occupied IN (0, 1)),
    occurred_at TEXT    NOT NULL,
    source      TEXT    NOT NULL DEFAULT 'api' CHECK (source IN ('api', 'simulator', 'sensor', 'visao')),
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now'))
);
CREATE INDEX IF NOT EXISTS ix_parking_events_space ON parking_events(space_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_parking_events_time  ON parking_events(occurred_at);
