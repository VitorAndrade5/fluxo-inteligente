"""Estacionamento inteligente: cada vaga fica verde (livre) ou vermelha (ocupada).

O estado vem de eventos por vaga, enviados pela visão computacional das câmeras
do estacionamento (ver vision/) ou por sensores; no MVP, pelo simulador abaixo.
"""
import random
from datetime import date, datetime, timedelta

from ..database import Database
from ..queries import q

KINDS = ("comum", "pne", "idoso", "neurodiverso", "gestante")
# ocupação-alvo do estacionamento por hora (curva de um shopping: almoço e noite)
TARGET = {9: 0.04, 10: 0.22, 11: 0.38, 12: 0.62, 13: 0.70, 14: 0.58, 15: 0.52, 16: 0.56,
          17: 0.66, 18: 0.82, 19: 0.92, 20: 0.90, 21: 0.70, 22: 0.35, 23: 0.05}
MEAN_STAY_MIN = 110


class ParkingError(ValueError):
    pass


def _day_window(day: date) -> tuple[str, str]:
    start = datetime.combine(day, datetime.min.time())
    return start.isoformat(), (start + timedelta(days=1)).isoformat()


def simulate_parking_day(conn: Database, day: date, seed: int | None = None, replace: bool = True) -> int:
    """Gera as entradas e saídas de cada vaga ao longo do dia. Não faz commit."""
    rng = random.Random((seed if seed is not None else day.toordinal()) * 7919 + 17)
    start, end = _day_window(day)
    if replace:
        conn.execute(q("delete_day_parking_events", conn.dialect), {"start": start, "end": end})
    spaces = conn.execute(
        """SELECT ps.id, ps.kind, l.preference FROM parking_spaces ps
           JOIN parking_lots l ON l.id = ps.lot_id ORDER BY ps.id"""
    ).fetchall()
    base = datetime.combine(day, datetime.min.time())
    step = 5  # minutos
    rows = []
    for sp in spaces:
        pref = sp["preference"] * (0.55 if sp["kind"] != "comum" else 1.0)
        t = base + timedelta(hours=9)
        stop = base + timedelta(hours=23, minutes=30)
        occupied_until = None
        while t < stop:
            if occupied_until and t >= occupied_until:
                rows.append((sp["id"], 0, occupied_until.isoformat(timespec="seconds"), "simulator"))
                occupied_until = None
            if occupied_until is None:
                p = min(0.97, TARGET.get(t.hour, 0.0) * pref)
                rate = p / ((1 - p) * MEAN_STAY_MIN) if p > 0 else 0  # chegadas/min para manter a ocupação-alvo
                if rng.random() < rate * step:
                    arrive = t + timedelta(minutes=rng.uniform(0, step))
                    stay = rng.uniform(35, 190) if t.hour < 17 else rng.uniform(60, 210)  # noite: cinema/jantar
                    occupied_until = min(arrive + timedelta(minutes=stay), stop)
                    rows.append((sp["id"], 1, arrive.isoformat(timespec="seconds"), "simulator"))
            t += timedelta(minutes=step)
        if occupied_until:
            rows.append((sp["id"], 0, occupied_until.isoformat(timespec="seconds"), "simulator"))
    conn.bulk_insert("parking_events", ("space_id", "occupied", "occurred_at", "source"), rows)
    return len(rows)


def _lots(conn: Database) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT code, name, level_label, total, rows_count, cols_count, is_estimate FROM parking_lots ORDER BY id")]


def status(conn: Database, at: datetime) -> dict:
    """Estado de todas as vagas no instante `at`, agrupado por setor."""
    params = {"at": at.isoformat(timespec="seconds"), "since": (at - timedelta(hours=24)).isoformat(timespec="seconds")}
    spaces = conn.execute(q("parking_status", conn.dialect), params).fetchall()
    lots = {lot["code"]: {**lot, "is_estimate": bool(lot["is_estimate"]), "free": 0, "occupied": 0,
                          "by_kind": {k: {"total": 0, "free": 0} for k in KINDS}, "spaces": []}
            for lot in _lots(conn)}
    for sp in spaces:
        lot = lots[sp["lot"]]
        occ = bool(sp["occupied"])
        lot["occupied" if occ else "free"] += 1
        lot["by_kind"][sp["kind"]]["total"] += 1
        lot["by_kind"][sp["kind"]]["free"] += 0 if occ else 1
        lot["spaces"].append({"code": sp["code"], "row": sp["row_idx"], "col": sp["col_idx"],
                              "kind": sp["kind"], "occupied": occ})
    for lot in lots.values():
        lot["occupancy"] = round(lot["occupied"] / lot["total"], 3)
        lot["state"] = "lotado" if lot["free"] <= max(2, lot["total"] * 0.03) else ("cheio" if lot["occupancy"] >= 0.85 else "livre")
    total = sum(l["total"] for l in lots.values())
    free = sum(l["free"] for l in lots.values())
    candidates = [l for l in lots.values() if l["state"] != "lotado"]
    best = max(candidates, key=lambda l: l["free"] / l["total"], default=None)
    return {
        "at": params["at"], "lots": list(lots.values()),
        "totals": {"total": total, "free": free, "occupied": total - free, "occupancy": round((total - free) / total, 3)},
        "recommended": best and {"code": best["code"], "name": best["name"], "free": best["free"]},
    }


def history(conn: Database, day: date, hours: range = range(9, 24)) -> dict:
    """Ocupação de cada setor no fim de cada hora, reconstruída a partir dos eventos do dia."""
    start, end = _day_window(day)
    lots = {lot["code"]: lot["total"] for lot in _lots(conn)}
    state: dict[int, tuple[str, int]] = {}
    events = conn.execute(q("parking_day_events", conn.dialect), {"start": start, "end": end}).fetchall()
    out = {code: [] for code in lots}
    i = 0
    for h in hours:
        limit = (datetime.combine(day, datetime.min.time()) + timedelta(hours=h + 1)).isoformat()
        while i < len(events) and str(events[i]["occurred_at"]).replace(" ", "T") < limit:
            ev = events[i]
            state[ev["space_id"]] = (ev["lot"], ev["occupied"])
            i += 1
        for code, total in lots.items():
            occ = sum(1 for lot, o in state.values() if lot == code and o)
            out[code].append({"hour": h, "occupancy": round(occ / total, 3)})
    return {"date": day.isoformat(), "lots": out}


def record_event(conn: Database, space: str, occupied: bool, occurred_at: str, source: str) -> dict:
    row = conn.execute("SELECT id FROM parking_spaces WHERE code = ?", (space,)).fetchone()
    if not row:
        raise ParkingError(f"vaga '{space}' não existe")
    event_id = conn.execute(
        "INSERT INTO parking_events (space_id, occupied, occurred_at, source) VALUES (?, ?, ?, ?) RETURNING id",
        (row["id"], 1 if occupied else 0, occurred_at, source),
    ).fetchone()["id"]
    return {"id": event_id, "space": space, "occupied": occupied, "occurred_at": occurred_at, "source": source}
