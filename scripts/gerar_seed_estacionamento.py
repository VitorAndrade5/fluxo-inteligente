"""Gera backend/sql/parking.seed.sql (setores e vagas do estacionamento).

Subsolos 1 e 2: quantidades da planta mix (pág. 1):
  Subsolo 1 = 140 vagas · 3 PNE / 11 idoso / 2 neurodiverso / 4 gestante e crianças
  Subsolo 2 = 216 vagas · 5 PNE / 8 idoso / 1 neurodiverso / 4 gestante e crianças
Térreo Norte e Bolsão Sul: a planta não informa o total -> ESTIMATIVA (is_estimate = 1),
confirme com a operação e ajuste aqui.

Uso: python scripts/gerar_seed_estacionamento.py
"""
from pathlib import Path

LOTS = [
    # id, code, name, level, rows, cols, is_estimate, preference, especiais
    (1, "S1", "Subsolo 1", "Subsolo 1", 7, 20, 0, 1.15, {"pne": 3, "gestante": 4, "neurodiverso": 2, "idoso": 11}),
    (2, "S2", "Subsolo 2", "Subsolo 2", 9, 24, 0, 1.0, {"pne": 5, "gestante": 4, "neurodiverso": 1, "idoso": 8}),
    (3, "TN", "Estacionamento Norte", "Térreo", 10, 30, 1, 0.9, {"pne": 6, "idoso": 10}),
    (4, "TS", "Bolsão Sul · Av. NS-05", "Térreo", 4, 24, 1, 0.75, {"pne": 2, "idoso": 3}),
]

out = [
    "-- Gerado por scripts/gerar_seed_estacionamento.py — não edite à mão.",
    "-- S1/S2: totais da planta mix. TN/TS: estimativa (is_estimate = 1).",
    "",
    "INSERT INTO parking_lots (id, code, name, level_label, total, rows_count, cols_count, is_estimate, preference) VALUES",
]
out.append(",\n".join(
    f"    ({i}, '{c}', '{n}', '{lv}', {r * k}, {r}, {k}, {est}, {pref})" for i, c, n, lv, r, k, est, pref, _ in LOTS
) + ";")
out += ["", "INSERT INTO parking_spaces (id, lot_id, code, row_idx, col_idx, kind) VALUES"]
rows, sid = [], 0
for lot_id, code, _, _, n_rows, n_cols, _, _, special in LOTS:
    kinds = [k for k, qty in special.items() for _ in range(qty)]  # vagas especiais perto do acesso (fileira A)
    for r in range(n_rows):
        for c in range(n_cols):
            sid += 1
            idx = r * n_cols + c
            kind = kinds[idx] if idx < len(kinds) else "comum"
            rows.append(f"    ({sid}, {lot_id}, '{code}-{chr(65 + r)}{c + 1:02d}', {r}, {c}, '{kind}')")
out.append(",\n".join(rows) + ";")
path = Path(__file__).resolve().parent.parent / "backend" / "sql" / "parking.seed.sql"
path.write_text("\n".join(out) + "\n", encoding="utf-8")
print(f"{path.name}: {len(LOTS)} setores, {sid} vagas")
