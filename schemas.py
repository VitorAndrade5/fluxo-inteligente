"""Contratos da API (entrada e saída)."""
from datetime import date as Date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Level = Literal["hot", "moderate", "cold"]


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class EventIn(BaseModel):
    """Passagem detectada por uma câmera: o visitante entrou em `to_zone`."""

    track_id: str = Field(min_length=1, max_length=64, description="ID anonimizado do rastreio")
    to_zone: str = Field(min_length=1, max_length=40, description="Código da zona de destino")
    from_zone: str | None = Field(
        default=None, max_length=40,
        description="Zona de origem; se omitida, é inferida pela última detecção do visitante (até 4 h)",
    )
    occurred_at: datetime
    camera_id: str | None = Field(default=None, max_length=60, description="external_id da câmera")
    source: Literal["api", "monuv"] = "api"

    @field_validator("to_zone", "from_zone")
    @classmethod
    def _upper(cls, value: str | None) -> str | None:
        return value.strip().upper() if value else value


class EventOut(BaseModel):
    id: int
    track_id: str
    from_zone: str | None
    to_zone: str
    occurred_at: str
    bucket_start: str
    source: str


class BatchIn(BaseModel):
    events: list[EventIn] = Field(min_length=1, max_length=5000)


class BatchOut(BaseModel):
    inserted: int
    events: list[EventOut]


class HeatZone(BaseModel):
    code: str
    name: str
    store_ref: str | None
    sector: str
    x: float
    y: float
    radius: float
    capacity_hour: int
    entries: int
    occupancy: float = Field(description="passagens / capacidade no intervalo (1.0 = 100%)")
    intensity: float = Field(description="0–1, relativo à zona mais movimentada do pavimento")
    level: Level


class HeatmapOut(BaseModel):
    floor: str
    date: Date
    hour: int | None
    total_entries: int
    hotspots: int
    coldspots: int
    zones: list[HeatZone]


class SimulateIn(BaseModel):
    date: Date | None = None
    visitors: int = Field(default=3000, ge=1, le=50_000)
    seed: int | None = None
    replace: bool = True
