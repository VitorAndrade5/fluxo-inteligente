-- =====================================================================
-- Dados de referência: pavimentos, setores, zonas e câmeras do
-- Capim Dourado Shopping (planta mix · novembro/2026).
-- Coordenadas em % sobre frontend/assets/piso-terreo.png e piso-2.png.
-- =====================================================================

INSERT INTO floors (id, code, name, level, plan_image, aspect_ratio) VALUES
    (1, 'T',  'Térreo · 1º pavimento',               1, 'assets/piso-terreo.png', 1.2973),
    (2, 'P2', '2º pavimento · Praça de Alimentação', 2, 'assets/piso-2.png',      1.5128);

INSERT INTO sectors (id, code, name, color) VALUES
    (1, 'ancora',         'Lojas âncora / Departamento', '#5ba8ff'),
    (2, 'vestuario',      'Vestuário',                   '#c792ff'),
    (3, 'alimentacao',    'Alimentação',                 '#f6b94a'),
    (4, 'entretenimento', 'Entretenimento & Lazer',      '#ff5d9e'),
    (5, 'servicos',       'Serviços & Varejo',           '#52d7c0'),
    (6, 'circulacao',     'Circulação & Praças',         '#b9f44b'),
    (7, 'acesso',         'Acessos & Estacionamento',    '#8aa39b');

INSERT INTO zones (code, floor_id, sector_id, name, store_ref, x_pct, y_pct, radius_pct, capacity_hour, attractiveness, is_entrance, connects_to)
WITH v(code, floor, sector, name, store_ref, x, y, r, cap, attr, ent, conn) AS (VALUES
    ('T-ENT-SUL', 'T', 'acesso', 'Entrada principal Sul', 'Acesso Av. NS-05', 43.6, 82.0, 5, 420, 1.0, 1, NULL),
    ('T-EST-NORTE', 'T', 'acesso', 'Estacionamento Norte', 'Acesso de veículos', 51.4, 20.0, 7, 300, 0.6, 1, NULL),
    ('T-EST-SUL', 'T', 'acesso', 'Estacionamento Sul', 'Bolsão Av. NS-05', 38.5, 90.0, 6, 270, 0.5, 1, NULL),
    ('T-ENT-OESTE', 'T', 'acesso', 'Acesso Oeste · Av. JK', 'Acesso pedestres', 12.8, 41.0, 4, 180, 0.5, 1, NULL),
    ('T-PRACA-NORTE', 'T', 'circulacao', 'Praça de Eventos Norte', 'Praça de eventos', 44.0, 44.0, 6, 195, 1.6, 0, NULL),
    ('T-PRACA-CENTRAL', 'T', 'circulacao', 'Praça de Eventos Central', 'Praça de eventos', 43.6, 65.0, 6, 225, 2.0, 0, NULL),
    ('T-PRACA-OESTE', 'T', 'circulacao', 'Praça Alameda das Cores', 'Alameda das Cores · 406,68 m²', 24.8, 72.0, 5, 150, 1.2, 0, NULL),
    ('T-PRACA-LESTE', 'T', 'circulacao', 'Praça de Eventos Leste', 'Praça de eventos', 61.0, 52.4, 5, 150, 1.2, 0, NULL),
    ('T-ESC-CENTRAL', 'T', 'circulacao', 'Escadas rolantes · Térreo', 'Esteira rolante · acesso ao Piso 2', 46.5, 71.5, 3, 540, 1.3, 0, 'P2-ESC'),
    ('T-CORR-OESTE', 'T', 'circulacao', 'Corredor Oeste', 'Polo Wear · Damyller', 24.0, 53.0, 4, 270, 1.0, 0, NULL),
    ('T-CORR-LESTE', 'T', 'circulacao', 'Corredor Leste', 'Lady Lord · Interação', 62.4, 61.3, 4, 270, 1.0, 0, NULL),
    ('T-RENNER', 'T', 'ancora', 'Renner', 'Loja âncora', 7.8, 70.2, 6, 192, 1.6, 0, NULL),
    ('T-CEA', 'T', 'ancora', 'C&A', 'Loja âncora', 42.8, 33.9, 6, 192, 1.5, 0, NULL),
    ('T-RIACHUELO', 'T', 'ancora', 'Riachuelo', 'Loja âncora', 43.9, 54.0, 6, 204, 1.7, 0, NULL),
    ('T-BIG', 'T', 'ancora', 'BIG Supermercado', 'Loja âncora', 80.3, 21.4, 6, 228, 1.6, 0, NULL),
    ('T-PERNAMBUCANAS', 'T', 'ancora', 'Pernambucanas', 'Loja âncora', 78.0, 41.7, 5, 156, 1.0, 0, NULL),
    ('T-POLO', 'T', 'vestuario', 'Polo Wear', 'Corredor oeste', 15.5, 49.0, 3, 96, 0.7, 0, NULL),
    ('T-STILO', 'T', 'vestuario', 'Stilo', 'Praça central', 32.0, 64.0, 3, 108, 0.9, 0, NULL),
    ('T-CENTAURO', 'T', 'vestuario', 'Centauro', 'Alameda das Cores', 27.5, 81.0, 4, 132, 1.0, 0, NULL),
    ('T-MARISA', 'T', 'vestuario', 'Marisa', 'Ala sul', 64.2, 79.2, 4, 132, 0.9, 0, NULL),
    ('T-STZ', 'T', 'vestuario', 'STZ', 'Ala leste', 78.9, 52.4, 4, 120, 0.8, 0, NULL),
    ('T-OUTBACK', 'T', 'alimentacao', 'Outback', 'Ala sul', 47.9, 75.0, 3, 96, 1.1, 0, NULL),
    ('T-MADERO', 'T', 'alimentacao', 'Madero', 'Ala sul', 53.7, 80.0, 3, 84, 0.9, 0, NULL),
    ('T-BK', 'T', 'alimentacao', 'Burger King', 'Ala leste', 78.0, 57.0, 3, 90, 0.9, 0, NULL),
    ('T-CINEMARK', 'T', 'entretenimento', 'Cinemark', 'Ala leste', 78.3, 68.5, 5, 180, 1.4, 0, NULL),
    ('T-ZIGZAG', 'T', 'entretenimento', 'Zig Zag Play', 'Ala leste', 78.7, 29.0, 4, 108, 0.8, 0, NULL),
    ('T-WOW', 'T', 'entretenimento', 'Wow Park', 'Ala leste', 78.4, 15.5, 4, 108, 0.7, 0, NULL),
    ('T-RIHAPPY', 'T', 'servicos', 'Ri Happy', 'Praça central', 26.6, 62.5, 3, 90, 0.8, 0, NULL),
    ('T-CAMICADO', 'T', 'servicos', 'Camicado', 'Ala sul', 39.4, 75.0, 3, 84, 0.8, 0, NULL),
    ('T-LEITURA', 'T', 'servicos', 'Livraria Leitura', 'Ala norte', 54.0, 43.5, 3, 96, 0.9, 0, NULL),
    ('T-BIGLAR', 'T', 'servicos', 'Big Lar', 'Ala leste', 79.4, 35.0, 4, 90, 0.6, 0, NULL),
    ('T-MOROFIT', 'T', 'servicos', 'Morofit', 'Ala leste', 76.6, 9.0, 4, 72, 0.4, 0, NULL),
    ('P2-ESC', 'P2', 'circulacao', 'Escadas rolantes · Piso 2', 'Esteira rolante · acesso ao Térreo', 77.0, 49.6, 4, 378, 1.3, 0, 'T-ESC-CENTRAL'),
    ('P2-P4', 'P2', 'circulacao', 'Acesso P4 · Elevador', 'Circulação', 35.0, 49.6, 3, 92, 0.7, 0, NULL),
    ('P2-MESAS-OESTE', 'P2', 'alimentacao', 'Mesas · setor oeste', 'Praça de Alimentação', 46.4, 48.0, 6, 210, 1.6, 0, NULL),
    ('P2-MESAS-CENTRO', 'P2', 'alimentacao', 'Mesas · setor central', 'Praça de Alimentação', 56.3, 48.0, 6, 231, 1.8, 0, NULL),
    ('P2-MESAS-LESTE', 'P2', 'alimentacao', 'Mesas · setor leste', 'Praça de Alimentação', 65.6, 48.0, 6, 210, 1.6, 0, NULL),
    ('P2-MCDONALDS', 'P2', 'alimentacao', 'McDonald''s', 'LOJA 214 · 161,69 m²', 42.1, 26.4, 4, 109, 1.8, 0, NULL),
    ('P2-SPOLETO', 'P2', 'alimentacao', 'Spoleto', 'LOJA 213 · 53,38 m²', 48.4, 26.4, 3, 59, 0.9, 0, NULL),
    ('P2-PIZZAHUT', 'P2', 'alimentacao', 'Pizza Hut', 'LOJA 212 · 37,25 m²', 52.2, 26.4, 3, 59, 0.9, 0, NULL),
    ('P2-VIVENDA', 'P2', 'alimentacao', 'Vivenda do Camarão', 'LOJA 211 · 35,44 m²', 55.6, 26.4, 3, 50, 0.7, 0, NULL),
    ('P2-DONAMARIA', 'P2', 'alimentacao', 'Dona Maria Express', 'LOJA 210 · 32,55 m²', 59.0, 26.0, 3, 50, 0.7, 0, NULL),
    ('P2-DIVINOFOGAO', 'P2', 'alimentacao', 'Divino Fogão', 'LOJA 209 · 57,43 m²', 63.7, 26.0, 3, 63, 1.0, 0, NULL),
    ('P2-KINSUI', 'P2', 'alimentacao', 'Kin Sui', 'LOJA 201 · 80,69 m²', 38.8, 64.5, 3, 50, 0.7, 0, NULL),
    ('P2-GIRAFFAS', 'P2', 'alimentacao', 'Giraffas', 'LOJA 202 · 65,41 m²', 43.6, 69.4, 3, 59, 0.9, 0, NULL),
    ('P2-SPAGHETTINI', 'P2', 'alimentacao', 'Spaghettini', 'LOJA 204 · 38,11 m²', 52.2, 70.2, 3, 46, 0.6, 0, NULL),
    ('P2-SUBWAY', 'P2', 'alimentacao', 'Subway', 'LOJA 206 · 27,88 m²', 58.9, 70.2, 3, 59, 1.0, 0, NULL),
    ('P2-EXPRESSGRILL', 'P2', 'alimentacao', 'Express Grill', 'LOJA 207 · 39,44 m²', 63.8, 70.7, 3, 50, 0.7, 0, NULL),
    ('P2-MUNDOIMERSIVO', 'P2', 'entretenimento', 'Mundo Imersivo', 'LOJA 215 · 250,94 m²', 31.7, 29.0, 5, 67, 0.8, 0, NULL),
    ('P2-IMERSOMAR', 'P2', 'entretenimento', 'Evento Imerso Mar', 'Espaço de eventos · 92,71 m²', 32.5, 67.0, 4, 59, 0.6, 0, NULL),
    ('P2-LOJA200', 'P2', 'servicos', 'Loja 200', 'LOJA 200 · 286,07 m²', 35.0, 78.5, 4, 40, 0.3, 0, NULL),
    ('P2-SANITARIOS', 'P2', 'servicos', 'Sanitários', 'Circ. social', 70.0, 21.5, 3, 50, 0.5, 0, NULL)
)
SELECT v.code, f.id, s.id, v.name, v.store_ref, v.x, v.y, v.r, v.cap, v.attr, v.ent, v.conn
FROM v
JOIN floors f ON f.code = v.floor
JOIN sectors s ON s.code = v.sector;

-- Uma câmera (sensor de fluxo) por zona; external_id segue o padrão da integração Monuv
INSERT INTO cameras (zone_id, external_id, name)
SELECT id, 'MNV-' || code, 'Câmera ' || name FROM zones;
