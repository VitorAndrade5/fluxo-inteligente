"""Processa um vídeo gravado com o mesmo pipeline do worker (YOLO + ByteTrack + regras de
tracking.py) e gera os arquivos que a tela "Câmeras · Visão" reproduz:

  <saida>.mp4   vídeo H.264 com as cabeças borradas (pode ser publicado)
  <saida>.json  caixas, ids de rastreio e contagens quadro a quadro

Uso:
    python vision/processar_video.py video.mp4 public/assets/videos/demo \\
        --label "Vídeo de demonstração" --model yolov8s.pt

ROI e linha de contagem são frações da largura/altura do quadro (0–1) e podem ser
ajustadas com --roi e --line. Requer ultralytics, opencv e ffmpeg no PATH.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tracking import LineCounter, Track, ZonePresence  # noqa: E402


def blur_heads(frame, boxes, cv2) -> None:
    """Pixeliza a parte de cima de cada pessoa (cabeça), com folga, antes de salvar o quadro."""
    h, w = frame.shape[:2]
    for x1, y1, x2, y2 in boxes:
        bw, bh = x2 - x1, y2 - y1
        hx1 = int(max(0, x1 - bw * 0.12)); hx2 = int(min(w, x2 + bw * 0.12))
        hy1 = int(max(0, y1 - bh * 0.04)); hy2 = int(min(h, y1 + bh * 0.24))
        region = frame[hy1:hy2, hx1:hx2]
        if region.size == 0:
            continue
        small = cv2.resize(region, (max(1, region.shape[1] // 10), max(1, region.shape[0] // 10)), interpolation=cv2.INTER_LINEAR)
        frame[hy1:hy2, hx1:hx2] = cv2.resize(small, (region.shape[1], region.shape[0]), interpolation=cv2.INTER_NEAREST)


def blur_faces(frame, cascade, cv2) -> int:
    """Segunda camada de anonimização: detector de rosto clássico (Haar) para quem o YOLO não viu
    (corpo escondido atrás de um balcão, pessoa cortada na borda do quadro)."""
    gray = cv2.equalizeHist(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
    faces = cascade.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=4, minSize=(14, 14))
    for x, y, w, h in faces:
        x1, y1 = max(0, int(x - w * 0.3)), max(0, int(y - h * 0.3))
        x2, y2 = min(frame.shape[1], int(x + w * 1.3)), min(frame.shape[0], int(y + h * 1.3))
        region = frame[y1:y2, x1:x2]
        small = cv2.resize(region, (max(1, region.shape[1] // 8), max(1, region.shape[0] // 8)))
        frame[y1:y2, x1:x2] = cv2.resize(small, (region.shape[1], region.shape[0]), interpolation=cv2.INTER_NEAREST)
    return len(faces)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("saida", help="caminho sem extensão, ex.: public/assets/videos/demo")
    ap.add_argument("--model", default="yolov8s.pt")
    ap.add_argument("--imgsz", type=int, default=1280)
    ap.add_argument("--conf", type=float, default=0.25, help="confiança mínima para contar/exibir")
    ap.add_argument("--blur-conf", type=float, default=0.08, help="confiança mínima para borrar (mais sensível)")
    ap.add_argument("--label", default="Vídeo de demonstração")
    ap.add_argument("--source-note", default="")
    ap.add_argument("--roi", default="0.04,0.26;0.96,0.26;1,1;0,1", help="polígono x,y;x,y;... (frações)")
    ap.add_argument("--line", default="0.08,0.66;0.92,0.66", help="linha de contagem x,y;x,y (frações)")
    ap.add_argument("--width", type=int, default=1280, help="largura do vídeo publicado")
    ap.add_argument("--mask", default="", help="máscaras de privacidade fixas x1,y1,x2,y2;... (frações), sempre pixeladas")
    args = ap.parse_args()

    import cv2
    from ultralytics import YOLO

    parse = lambda s: [tuple(float(v) for v in p.split(",")) for p in s.split(";")]
    roi_n, line_n = parse(args.roi), parse(args.line)
    masks = [tuple(float(v) for v in m.split(",")) for m in args.mask.split(";") if m.strip()]

    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    model = YOLO(args.model)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces_total = 0
    line = LineCounter((line_n[0][0] * W, line_n[0][1] * H), (line_n[1][0] * W, line_n[1][1] * H))
    zone = ZonePresence([(x * W, y * H) for x, y in roi_n], min_frames=3)

    out_w = args.width; out_h = round(H * out_w / W / 2) * 2
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False).name
    writer = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (out_w, out_h))

    frames, counts, ids = [], [], set()
    t0 = time.time()
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        res = model.track(frame, persist=True, classes=[0], conf=args.blur_conf, imgsz=args.imgsz,
                          tracker="bytetrack.yaml", verbose=False)[0]
        tracks, to_blur = [], []
        if res.boxes is not None:
            to_blur = [tuple(b) for b in res.boxes.xyxy.tolist()]  # tudo que parece pessoa é borrado
            if res.boxes.id is not None:
                for box, tid, conf in zip(res.boxes.xyxy.tolist(), res.boxes.id.int().tolist(), res.boxes.conf.tolist()):
                    if conf >= args.conf:
                        tracks.append(Track(tid, "person", tuple(box), conf))
        line.update(tracks)
        zone.update(tracks)
        ids.update(t.id for t in tracks)
        frames.append([[t.id, round(t.box[0] / W, 4), round(t.box[1] / H, 4), round(t.box[2] / W, 4),
                        round(t.box[3] / H, 4), round(t.conf, 2)] for t in tracks])
        counts.append([line.entries, line.exits, zone.count])
        blur_heads(frame, to_blur, cv2)
        faces_total += blur_faces(frame, cascade, cv2)
        for mx1, my1, mx2, my2 in masks:  # máscara de privacidade (bordas e balcões onde o detector não alcança)
            x1, y1, x2, y2 = int(mx1 * W), int(my1 * H), int(mx2 * W), int(my2 * H)
            region = frame[y1:y2, x1:x2]
            if region.size:
                small = cv2.resize(region, (max(1, region.shape[1] // 14), max(1, region.shape[0] // 14)))
                frame[y1:y2, x1:x2] = cv2.resize(small, (region.shape[1], region.shape[0]), interpolation=cv2.INTER_NEAREST)
        writer.write(cv2.resize(frame, (out_w, out_h), interpolation=cv2.INTER_AREA))
        i += 1
        if i % 25 == 0:
            print(f"  quadro {i}/{total} · {len(tracks)} pessoas · {time.time() - t0:.0f}s")
    writer.release(); cap.release()

    out = Path(args.saida); out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "27",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out.with_suffix(".mp4"))], check=True)
    Path(tmp).unlink(missing_ok=True)

    per_frame = [len(f) for f in frames]
    data = {
        "label": args.label, "source_note": args.source_note,
        "video": out.with_suffix(".mp4").name, "fps": fps, "width": out_w, "height": out_h, "frames": len(frames),
        "model": f"{Path(args.model).stem} + ByteTrack", "roi": roi_n, "line": line_n, "masks": masks,
        "summary": {"unique_tracks": len(ids), "max_in_frame": max(per_frame, default=0),
                    "avg_in_frame": round(sum(per_frame) / max(1, len(per_frame)), 1),
                    "entries": line.entries, "exits": line.exits, "seconds": round(len(frames) / fps, 1)},
        "counts": counts,      # por quadro: [entradas acumuladas, saídas acumuladas, pessoas na ROI]
        "tracks": frames,      # por quadro: [[id, x1, y1, x2, y2, conf], ...] em frações do quadro
    }
    payload = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    out.with_suffix(".json").write_text(payload, encoding="utf-8")
    # mesma coisa como script, para o painel carregar também quando aberto direto do disco (file://)
    out.with_suffix(".js").write_text(f"window.FLUXO_VIDEO_DEMO = {payload};\n", encoding="utf-8")
    print(f"ok: {len(frames)} quadros, {len(ids)} ids, entradas {line.entries}, saídas {line.exits} "
          f"· {faces_total} rostos extras borrados ({time.time() - t0:.0f}s) -> {out.with_suffix('.mp4')} / {out.with_suffix('.json')}")


if __name__ == "__main__":
    main()
