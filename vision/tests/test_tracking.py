import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tracking import (LineCounter, ParkingMonitor, Track, ZonePresence, anonymous_id,  # noqa: E402
                      box_coverage, point_in_polygon)


def pessoa(tid, cx, foot_y, h=120):
    return Track(tid, "person", (cx - 20, foot_y - h, cx + 20, foot_y))


def test_linha_conta_entrada_e_saida_uma_vez():
    linha = LineCounter((0, 500), (1000, 500))
    for y in (400, 450, 520, 560):          # desce: atravessa a linha uma vez
        linha.update([pessoa(1, 300, y)])
    for y in (560, 480, 430):               # outra pessoa sobe
        linha.update([pessoa(2, 600, y)])
    assert (linha.entries, linha.exits) == (1, 1)
    linha.update([pessoa(3, 1500, 400)])
    linha.update([pessoa(3, 1500, 600)])    # cruza fora do segmento: não conta
    assert (linha.entries, linha.exits) == (1, 1)


def test_zona_confirma_depois_de_quadros_seguidos_e_ignora_veiculos():
    roi = [(0, 0), (1000, 0), (1000, 700), (0, 700)]
    zona = ZonePresence(roi, min_frames=3)
    novos = [zona.update([pessoa(7, 100, 300), Track(9, "car", (0, 0, 50, 50))]) for _ in range(4)]
    assert novos == [[], [], [7], []]
    assert zona.count == 1
    zona.update([])                          # saiu do quadro
    assert zona.count == 0


def test_vaga_so_muda_apos_confirmacao():
    vaga = [(0, 0), (100, 0), (100, 200), (0, 200)]
    mon = ParkingMonitor({"S1-A01": vaga}, confirm_frames=3)
    carro = Track(1, "car", (5, 10, 95, 190))
    assert [mon.update([carro]) for _ in range(3)] == [[], [], [("S1-A01", True)]]
    assert mon.free == 0
    pessoa_na_vaga = Track(2, "person", (40, 50, 60, 190))
    assert [mon.update([pessoa_na_vaga]) for _ in range(3)][-1] == [("S1-A01", False)]
    assert mon.free == 1


def test_geometria_e_id_anonimo():
    quad = [(0, 0), (10, 0), (10, 10), (0, 10)]
    assert point_in_polygon((5, 5), quad) and not point_in_polygon((15, 5), quad)
    assert box_coverage((0, 0, 5, 10), quad) == 0.5
    a = anonymous_id("MNV-1", 4, "2026-11-14", "s")
    assert a == anonymous_id("MNV-1", 4, "2026-11-14", "s")
    assert a != anonymous_id("MNV-1", 4, "2026-11-15", "s")   # muda todo dia
    assert a.startswith("TRK-") and len(a) == 20
