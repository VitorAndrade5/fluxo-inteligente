-- =====================================================================
-- Fluxo Inteligente · consultas nomeadas
--
-- Este arquivo é carregado pelo backend (app/queries.py): cada bloco
-- começa com "-- name: <identificador>" e usa parâmetros nomeados
-- (:start, :end, :floor ...). Intervalos de tempo são sempre
-- semiabertos: occurred_at >= :start AND occurred_at < :end.
--
-- O mesmo arquivo serve SQLite e PostgreSQL. Quando a sintaxe diverge,
-- existe uma variante "-- name: <identificador>@postgres".
-- Filtros opcionais usam CAST(:p AS TEXT) IS NULL para o PostgreSQL
-- conseguir inferir o tipo do parâmetro nulo.
-- =====================================================================


-- name: upsert_hourly_stat
-- Mantém o agregado horário que alimenta o mapa de calor.
INSERT INTO zone_hourly_stats (zone_id, bucket_start, entries)
VALUES (:zone_id, :bucket_start, 1)
ON CONFLICT (zone_id, bucket_start)
DO UPDATE SET entries = zone_hourly_stats.entries + 1;


-- name: last_event_for_visitor
-- Usado para inferir a zona de origem quando a câmera só informa a zona de destino.
SELECT e.to_zone_id, e.occurred_at
FROM movement_events e
WHERE e.visitor_id = :visitor_id
  AND e.occurred_at <= :occurred_at
  AND e.occurred_at >= :window_start
ORDER BY e.occurred_at DESC, e.id DESC
LIMIT 1;


-- name: heatmap
-- Concentração por zona em um pavimento e intervalo (hora ou dia).
SELECT z.code, z.name, z.store_ref, s.code AS sector,
       z.x_pct, z.y_pct, z.radius_pct, z.capacity_hour,
       COALESCE(SUM(h.entries), 0) AS entries
FROM zones z
JOIN floors  f ON f.id = z.floor_id
JOIN sectors s ON s.id = z.sector_id
LEFT JOIN zone_hourly_stats h
       ON h.zone_id = z.id
      AND h.bucket_start >= :start
      AND h.bucket_start <  :end
WHERE f.code = :floor
GROUP BY z.id, z.code, z.name, z.store_ref, s.code, z.x_pct, z.y_pct, z.radius_pct, z.capacity_hour
ORDER BY entries DESC, z.code;


-- name: timeline
-- Passagens por hora do dia (todas as zonas ou um pavimento).
SELECT CAST(substr(h.bucket_start, 12, 2) AS INTEGER) AS hour,
       SUM(h.entries) AS entries
FROM zone_hourly_stats h
JOIN zones  z ON z.id = h.zone_id
JOIN floors f ON f.id = z.floor_id
WHERE h.bucket_start >= :start
  AND h.bucket_start <  :end
  AND (CAST(:floor AS TEXT) IS NULL OR f.code = :floor)
GROUP BY hour
ORDER BY hour;


-- name: timeline@postgres
SELECT CAST(EXTRACT(HOUR FROM h.bucket_start) AS INTEGER) AS hour,
       SUM(h.entries) AS entries
FROM zone_hourly_stats h
JOIN zones  z ON z.id = h.zone_id
JOIN floors f ON f.id = z.floor_id
WHERE h.bucket_start >= :start
  AND h.bucket_start <  :end
  AND (CAST(:floor AS TEXT) IS NULL OR f.code = :floor)
GROUP BY 1
ORDER BY 1;


-- name: summary
-- Volume de passagens e visitantes únicos no intervalo.
SELECT COUNT(*)                   AS events,
       COUNT(DISTINCT e.visitor_id) AS visitors
FROM movement_events e
WHERE e.occurred_at >= :start
  AND e.occurred_at <  :end;


-- name: zone_dwell
-- Permanência média (min) por zona: tempo até a próxima detecção do mesmo visitante.
WITH ordered AS (
    SELECT e.to_zone_id,
           e.occurred_at,
           LEAD(e.occurred_at) OVER (PARTITION BY e.visitor_id ORDER BY e.occurred_at, e.id) AS next_at
    FROM movement_events e
    WHERE e.occurred_at >= :start
      AND e.occurred_at <  :end
)
SELECT z.code,
       ROUND(AVG((julianday(o.next_at) - julianday(o.occurred_at)) * 1440), 1) AS avg_minutes,
       COUNT(*) AS samples
FROM ordered o
JOIN zones  z ON z.id = o.to_zone_id
JOIN floors f ON f.id = z.floor_id
WHERE o.next_at IS NOT NULL
  AND (CAST(:floor AS TEXT) IS NULL OR f.code = :floor)
GROUP BY z.id, z.code;


-- name: zone_dwell@postgres
WITH ordered AS (
    SELECT e.to_zone_id,
           e.occurred_at,
           LEAD(e.occurred_at) OVER (PARTITION BY e.visitor_id ORDER BY e.occurred_at, e.id) AS next_at
    FROM movement_events e
    WHERE e.occurred_at >= :start
      AND e.occurred_at <  :end
)
SELECT z.code,
       CAST(ROUND(CAST(AVG(EXTRACT(EPOCH FROM (o.next_at - o.occurred_at)) / 60) AS NUMERIC), 1) AS DOUBLE PRECISION) AS avg_minutes,
       COUNT(*) AS samples
FROM ordered o
JOIN zones  z ON z.id = o.to_zone_id
JOIN floors f ON f.id = z.floor_id
WHERE o.next_at IS NOT NULL
  AND (CAST(:floor AS TEXT) IS NULL OR f.code = :floor)
GROUP BY z.id, z.code;


-- name: top_transitions
-- Trajetos diretos mais comuns (Zona A -> Zona B).
SELECT fz.code AS from_code, fz.name AS from_name,
       tz.code AS to_code,   tz.name AS to_name,
       ff.code AS from_floor, tf.code AS to_floor,
       COUNT(*) AS total
FROM movement_events e
JOIN zones  fz ON fz.id = e.from_zone_id
JOIN zones  tz ON tz.id = e.to_zone_id
JOIN floors ff ON ff.id = fz.floor_id
JOIN floors tf ON tf.id = tz.floor_id
WHERE e.occurred_at >= :start
  AND e.occurred_at <  :end
  AND (CAST(:from_zone AS TEXT) IS NULL OR fz.code = :from_zone)
  AND (CAST(:to_zone AS TEXT)   IS NULL OR tz.code = :to_zone)
GROUP BY fz.id, fz.code, fz.name, tz.id, tz.code, tz.name, ff.code, tf.code
ORDER BY total DESC
LIMIT :limit;


-- name: sector_matrix
-- Tráfego cruzado entre setores (ex.: Praça de Alimentação vs. Lojas de Departamento).
SELECT fs.code AS from_sector, ts.code AS to_sector, COUNT(*) AS total
FROM movement_events e
JOIN zones   fz ON fz.id = e.from_zone_id
JOIN zones   tz ON tz.id = e.to_zone_id
JOIN sectors fs ON fs.id = fz.sector_id
JOIN sectors ts ON ts.id = tz.sector_id
WHERE e.occurred_at >= :start
  AND e.occurred_at <  :end
GROUP BY fs.code, ts.code;


-- name: paths_to_zone
-- Sequências de até 3 zonas percorridas antes de chegar ao destino
-- (ex.: "quais corredores o cliente percorre antes de ir ao cinema?").
WITH ordered AS (
    SELECT e.visitor_id,
           e.to_zone_id,
           LAG(e.to_zone_id, 1) OVER w AS prev1,
           LAG(e.to_zone_id, 2) OVER w AS prev2,
           LAG(e.to_zone_id, 3) OVER w AS prev3
    FROM movement_events e
    WHERE e.occurred_at >= :start
      AND e.occurred_at <  :end
    WINDOW w AS (PARTITION BY e.visitor_id ORDER BY e.occurred_at, e.id)
)
SELECT z3.code AS step1, z2.code AS step2, z1.code AS step3,
       COUNT(*) AS total
FROM ordered o
JOIN zones t       ON t.id  = o.to_zone_id
JOIN zones z1      ON z1.id = o.prev1
LEFT JOIN zones z2 ON z2.id = o.prev2
LEFT JOIN zones z3 ON z3.id = o.prev3
WHERE t.code = :zone
GROUP BY z3.code, z2.code, z1.code
ORDER BY total DESC
LIMIT :limit;


-- name: sector_destinations
-- Para onde vai quem acabou de passar por uma zona do setor (próxima zona de outro setor).
WITH ordered AS (
    SELECT e.to_zone_id,
           LEAD(e.to_zone_id) OVER (PARTITION BY e.visitor_id ORDER BY e.occurred_at, e.id) AS next_zone
    FROM movement_events e
    WHERE e.occurred_at >= :start
      AND e.occurred_at <  :end
)
SELECT nz.code, nz.name, COUNT(*) AS total
FROM ordered o
JOIN zones   z  ON z.id  = o.to_zone_id
JOIN sectors s  ON s.id  = z.sector_id
JOIN zones   nz ON nz.id = o.next_zone
WHERE s.code = :sector
  AND nz.sector_id <> z.sector_id
GROUP BY nz.id, nz.code, nz.name
ORDER BY total DESC
LIMIT :limit;


-- name: sector_origins
-- De onde vem quem entra em uma zona do setor (zona anterior de outro setor).
WITH ordered AS (
    SELECT e.to_zone_id,
           LAG(e.to_zone_id) OVER (PARTITION BY e.visitor_id ORDER BY e.occurred_at, e.id) AS prev_zone
    FROM movement_events e
    WHERE e.occurred_at >= :start
      AND e.occurred_at <  :end
)
SELECT pz.code, pz.name, COUNT(*) AS total
FROM ordered o
JOIN zones   z  ON z.id  = o.to_zone_id
JOIN sectors s  ON s.id  = z.sector_id
JOIN zones   pz ON pz.id = o.prev_zone
WHERE s.code = :sector
  AND pz.sector_id <> z.sector_id
GROUP BY pz.id, pz.code, pz.name
ORDER BY total DESC
LIMIT :limit;


-- name: visitor_journey
-- Jornada completa de um visitante anonimizado.
SELECT e.id, fz.code AS from_zone, tz.code AS to_zone, tz.name AS to_name,
       e.occurred_at, e.source
FROM movement_events e
JOIN visitors v       ON v.id  = e.visitor_id
JOIN zones tz         ON tz.id = e.to_zone_id
LEFT JOIN zones fz    ON fz.id = e.from_zone_id
WHERE v.track_id = :track_id
ORDER BY e.occurred_at, e.id;


-- name: dates_with_data
SELECT substr(bucket_start, 1, 10) AS day, SUM(entries) AS entries
FROM zone_hourly_stats
GROUP BY day
ORDER BY day DESC
LIMIT 31;


-- name: dates_with_data@postgres
SELECT to_char(bucket_start, 'YYYY-MM-DD') AS day, SUM(entries) AS entries
FROM zone_hourly_stats
GROUP BY 1
ORDER BY 1 DESC
LIMIT 31;


-- name: delete_day_events
DELETE FROM movement_events
WHERE occurred_at >= :start AND occurred_at < :end AND source = 'simulator';


-- name: rebuild_day_stats
-- Recalcula o agregado de um dia a partir dos eventos brutos.
INSERT INTO zone_hourly_stats (zone_id, bucket_start, entries)
SELECT to_zone_id, substr(occurred_at, 1, 13) || ':00:00', COUNT(*)
FROM movement_events
WHERE occurred_at >= :start AND occurred_at < :end
GROUP BY to_zone_id, substr(occurred_at, 1, 13);


-- name: rebuild_day_stats@postgres
INSERT INTO zone_hourly_stats (zone_id, bucket_start, entries)
SELECT to_zone_id, date_trunc('hour', occurred_at), COUNT(*)
FROM movement_events
WHERE occurred_at >= :start AND occurred_at < :end
GROUP BY to_zone_id, date_trunc('hour', occurred_at);


-- name: delete_day_stats
DELETE FROM zone_hourly_stats
WHERE bucket_start >= :start AND bucket_start < :end;
