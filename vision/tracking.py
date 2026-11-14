"""Regras de visão computacional independentes do modelo (testáveis sem GPU/OpenCV).

O detector (YOLO) e o rastreador (ByteTrack) entregam, a cada quadro, uma lista
de objetos `Track(id, cls, box)`. Este módulo transforma isso em eventos de
negócio:

- `LineCounter`: entradas/saídas quando o centro de uma pessoa cruza a linha de contagem.
- `ZonePresence`: pessoas dentro da região (ROI) da câmera e quem acabou de entrar.
- `ParkingMonitor`: vaga ocupada/livre quando um veículo cobre o polígono da vaga
  por alguns quadros seguidos (evita piscar com sombras e pessoas passando).

Privacidade (LGPD): nada aqui recebe ou guarda imagem; só caixas e ids de
rastreio locais, que viram um hash diário e anônimo antes de sair da câmera.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

Point = tuple[float, float]
Box = tuple[float, float, float, float]  # x1, y1, x2, y2 (pixels)

PERSON = "person"
VEHICLES = {"car", "truck", "bus", "motorcycle"}


@dataclass(frozen=True)
class Track:
    id: int
    cls: str
    box: Box
    conf: float = 1.0

    @property
    def foot(self) -> Point:
        """Ponto de apoio (meio da base da caixa): melhor que o centro para perspectiva de câmera alta."""
        x1, _, x2, y2 = self.box
        return ((x1 + x2) / 2, y2)


def anonymous_id(camera_id: str, track_id: int, day: str, salt: str) -> str:
    """Id de rastreio anônimo: muda todo dia e não pode ser revertido sem o segredo."""
    raw = f"{salt}|{camera_id}|{day}|{track_id}".encode()
    return "TRK-" + hashlib.sha256(raw).hexdigest()[:16]


def _side(p: Point, a: Point, b: Point) -> float:
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def point_in_polygon(p: Point, poly: list[Point]) -> bool:
    x, y = p
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def polygon_area(poly: list[Point]) -> float:
    return abs(sum(poly[i][0] * poly[i - 1][1] - poly[i - 1][0] * poly[i][1] for i in range(len(poly)))) / 2


def box_coverage(box: Box, poly: list[Point], samples: int = 8) -> float:
    """Fração do polígono coberta pela caixa (amostragem em grade dentro do retângulo do polígono)."""
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    inside = covered = 0
    for i in range(samples):
        for j in range(samples):
            pt = (min(xs) + (max(xs) - min(xs)) * (i + 0.5) / samples,
                  min(ys) + (max(ys) - min(ys)) * (j + 0.5) / samples)
            if point_in_polygon(pt, poly):
                inside += 1
                if box[0] <= pt[0] <= box[2] and box[1] <= pt[1] <= box[3]:
                    covered += 1
    return covered / inside if inside else 0.0


@dataclass
class LineCounter:
    """Linha virtual A→B. Cruzar do lado positivo para o negativo = entrada."""

    a: Point
    b: Point
    entries: int = 0
    exits: int = 0
    _last_side: dict[int, float] = field(default_factory=dict)

    def update(self, tracks: list[Track]) -> list[tuple[int, str]]:
        crossed = []
        for t in tracks:
            if t.cls != PERSON:
                continue
            s = _side(t.foot, self.a, self.b)
            prev = self._last_side.get(t.id)
            if prev is not None and prev * s < 0 and self._within_segment(t.foot):
                direction = "in" if prev > 0 else "out"
                if direction == "in":
                    self.entries += 1
                else:
                    self.exits += 1
                crossed.append((t.id, direction))
            if s != 0:
                self._last_side[t.id] = s
        return crossed

    def _within_segment(self, p: Point) -> bool:
        (ax, ay), (bx, by) = self.a, self.b
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy or 1e-12
        u = ((p[0] - ax) * dx + (p[1] - ay) * dy) / length2
        return -0.05 <= u <= 1.05


@dataclass
class ZonePresence:
    """Quem está dentro da ROI da câmera; `update` devolve os ids que acabaram de entrar."""

    roi: list[Point]
    min_frames: int = 3  # quadros seguidos dentro para confirmar (evita falso positivo)
    _streak: dict[int, int] = field(default_factory=dict)
    inside: set[int] = field(default_factory=set)

    def update(self, tracks: list[Track]) -> list[int]:
        seen, new = set(), []
        for t in tracks:
            if t.cls != PERSON or not point_in_polygon(t.foot, self.roi):
                continue
            seen.add(t.id)
            self._streak[t.id] = self._streak.get(t.id, 0) + 1
            if self._streak[t.id] == self.min_frames:
                self.inside.add(t.id)
                new.append(t.id)
        for tid in list(self._streak):
            if tid not in seen:
                del self._streak[tid]
                self.inside.discard(tid)
        return new

    @property
    def count(self) -> int:
        return len(self.inside)


@dataclass
class ParkingMonitor:
    """Estado das vagas vistas por uma câmera do estacionamento."""

    spaces: dict[str, list[Point]]  # código da vaga -> polígono em pixels
    coverage: float = 0.45          # fração mínima da vaga coberta por um veículo
    confirm_frames: int = 5         # quadros seguidos para trocar o estado
    state: dict[str, bool] = field(default_factory=dict)
    _pending: dict[str, int] = field(default_factory=dict)

    def update(self, tracks: list[Track]) -> list[tuple[str, bool]]:
        vehicles = [t for t in tracks if t.cls in VEHICLES]
        changes = []
        for code, poly in self.spaces.items():
            occupied_now = any(box_coverage(v.box, poly) >= self.coverage for v in vehicles)
            current = self.state.get(code, False)
            if occupied_now == current:
                self._pending.pop(code, None)
                continue
            self._pending[code] = self._pending.get(code, 0) + 1
            if self._pending[code] >= self.confirm_frames:
                self.state[code] = occupied_now
                self._pending.pop(code)
                changes.append((code, occupied_now))
        return changes

    @property
    def free(self) -> int:
        return sum(1 for code in self.spaces if not self.state.get(code, False))
