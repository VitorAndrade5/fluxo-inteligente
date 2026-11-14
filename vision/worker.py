"""Worker de visão computacional por câmera (roda na borda, perto do DVR/NVR).

Lê o vídeo (RTSP, arquivo ou webcam), detecta pessoas/veículos com YOLO,
rastreia com ByteTrack e envia para a API do Fluxo Inteligente apenas eventos
anônimos: passagem em zona (POST /api/events) ou estado de vaga
(POST /api/parking/events). Nenhum quadro é gravado nem enviado.

Instalação (máquina da borda):
    pip install -r vision/requirements.txt

Exemplos:
    # câmera de corredor: conta quem entra na zona e cruza a linha
    python vision/worker.py --config vision/config.exemplo.json --camera MNV-T-PRACA-CENTRAL \\
        --api https://seu-projeto.vercel.app --api-key "$FLUXO_INGEST_KEY"

    # só testar com um vídeo, sem enviar nada, mostrando a janela com as caixas
    python vision/worker.py --config vision/config.exemplo.json --camera MNV-S1-CAM01 \\
        --source estacionamento.mp4 --dry-run --show

Sobre jornadas entre câmeras: o id de rastreio é local de cada câmera. Para
ligar o mesmo visitante entre câmeras (trajeto A -> B), use o id anônimo de
reidentificação fornecido pela plataforma de visão (ex.: Monuv) no campo
track_id; sem isso, o sistema mede presença e fluxo por zona.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tracking import LineCounter, ParkingMonitor, Track, ZonePresence, anonymous_id  # noqa: E402

MALL_TZ = timezone(timedelta(hours=-3))
COCO = {0: "person", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}


class ApiClient:
    def __init__(self, base: str, key: str, dry_run: bool):
        self.base, self.key, self.dry_run = base.rstrip("/"), key, dry_run
        self.buffer: list[dict] = []

    def person_event(self, event: dict) -> None:
        self.buffer.append(event)

    def parking_event(self, event: dict) -> None:
        self._post("/api/parking/events", event)

    def flush(self) -> None:
        if not self.buffer:
            return
        batch, self.buffer = self.buffer, []
        self._post("/api/events/batch", {"events": batch})

    def _post(self, path: str, body: dict) -> None:
        if self.dry_run:
            print("[dry-run]", path, json.dumps(body, ensure_ascii=False))
            return
        import httpx

        for attempt in range(4):
            try:
                r = httpx.post(self.base + path, json=body, headers={"X-API-Key": self.key}, timeout=10)
                r.raise_for_status()
                return
            except httpx.HTTPError as exc:
                wait = 2 ** attempt
                print(f"falha ao enviar ({exc}); nova tentativa em {wait}s", file=sys.stderr)
                time.sleep(wait)
        print("evento descartado após 4 tentativas", file=sys.stderr)


def load_camera(config_path: str, camera_id: str) -> dict:
    data = json.loads(Path(config_path).read_text(encoding="utf-8"))
    for cam in data["cameras"]:
        if cam["camera_id"] == camera_id:
            return cam
    sys.exit(f"câmera {camera_id} não está em {config_path}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", required=True)
    ap.add_argument("--camera", required=True, help="external_id da câmera (tabela cameras)")
    ap.add_argument("--source", help="RTSP/arquivo/índice da webcam; padrão: o 'source' do config")
    ap.add_argument("--api", default=os.getenv("FLUXO_API", "http://localhost:8000"))
    ap.add_argument("--api-key", default=os.getenv("FLUXO_INGEST_KEY", ""))
    ap.add_argument("--model", default="yolov8n.pt")
    ap.add_argument("--salt", default=os.getenv("FLUXO_TRACK_SALT", "troque-este-segredo"))
    ap.add_argument("--fps", type=float, default=5, help="quadros analisados por segundo")
    ap.add_argument("--dry-run", action="store_true", help="não envia, só imprime os eventos")
    ap.add_argument("--show", action="store_true", help="janela de depuração com caixas (rostos borrados)")
    args = ap.parse_args()

    import cv2  # dependências pesadas só no worker
    from ultralytics import YOLO

    cam = load_camera(args.config, args.camera)
    source = args.source or cam["source"]
    cap = cv2.VideoCapture(int(source) if str(source).isdigit() else source)
    if not cap.isOpened():
        sys.exit(f"não foi possível abrir {source}")
    model = YOLO(args.model)
    api = ApiClient(args.api, args.api_key, args.dry_run)

    mode = cam.get("mode", "pessoas")
    line = LineCounter(tuple(cam["line"][0]), tuple(cam["line"][1])) if cam.get("line") else None
    zone = ZonePresence([tuple(p) for p in cam["roi"]]) if cam.get("roi") else None
    parking = ParkingMonitor({k: [tuple(p) for p in v] for k, v in cam.get("spaces", {}).items()})
    classes = [0] if mode == "pessoas" else [2, 3, 5, 7]

    interval, last, last_flush = 1 / args.fps, 0.0, time.time()
    print(f"{args.camera} ({mode}) analisando {source} a {args.fps} qps")
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        now = time.time()
        if now - last < interval:
            continue
        last = now
        result = model.track(frame, persist=True, classes=classes, verbose=False, tracker="bytetrack.yaml")[0]
        tracks = []
        if result.boxes is not None and result.boxes.id is not None:
            for box, tid, cls, conf in zip(result.boxes.xyxy.tolist(), result.boxes.id.int().tolist(),
                                           result.boxes.cls.int().tolist(), result.boxes.conf.tolist()):
                tracks.append(Track(tid, COCO.get(cls, "other"), tuple(box), conf))
        stamp = datetime.now(MALL_TZ)

        if mode == "pessoas":
            if line:
                line.update(tracks)
            for tid in zone.update(tracks) if zone else []:
                api.person_event({
                    "track_id": anonymous_id(args.camera, tid, stamp.date().isoformat(), args.salt),
                    "to_zone": cam["zone"], "camera_id": args.camera,
                    "occurred_at": stamp.isoformat(timespec="seconds"), "source": "monuv",
                })
        else:
            for code, occupied in parking.update(tracks):
                api.parking_event({"space": code, "occupied": occupied,
                                   "occurred_at": stamp.isoformat(timespec="seconds"), "source": "visao"})

        if now - last_flush >= 10:
            api.flush()
            last_flush = now

        if args.show:
            for t in tracks:
                x1, y1, x2, y2 = map(int, t.box)
                if t.cls == "person":  # borra a parte de cima da caixa (rosto) antes de exibir
                    head = frame[y1:y1 + max(1, (y2 - y1) // 4), x1:x2]
                    if head.size:
                        frame[y1:y1 + head.shape[0], x1:x2] = cv2.GaussianBlur(head, (31, 31), 0)
                cv2.rectangle(frame, (x1, y1), (x2, y2), (75, 244, 185), 2)
                cv2.putText(frame, f"#{t.id} {t.conf:.2f}", (x1, y1 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (75, 244, 185), 1)
            hud = f"{args.camera} pessoas={zone.count if zone else 0}" if mode == "pessoas" else f"{args.camera} livres={parking.free}"
            cv2.putText(frame, hud, (12, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            cv2.imshow("Fluxo Inteligente · visão", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    api.flush()
    cap.release()


if __name__ == "__main__":
    main()
