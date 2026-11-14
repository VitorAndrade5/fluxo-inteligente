/* Câmeras · visão computacional.
 * Para cada câmera (uma por zona) mostra os números do backend (GET /api/cameras) e uma
 * CENA ILUSTRATIVA gerada por computador do ambiente, com a sobreposição que o worker de
 * visão (vision/worker.py: YOLO + ByteTrack) produz: caixas, id de rastreio, trilhas,
 * linha de contagem, região monitorada e anonimização. Não é imagem real das câmeras. */
(() => {
  "use strict";
  const V = (window.FluxoViews ||= {});
  const W = 960; const H = 540; const VX = 480; const VY = 150;
  const SHIRTS = ["#6f7f8c", "#8a5a4a", "#3f5a74", "#7d7a52", "#5b4a6e", "#9a8f7e", "#4b6b5a", "#a0614f", "#2f3e4f", "#7a6a5a", "#b49a6a", "#55606a"];
  const SKIN = ["#c9a184", "#a87b5f", "#8a5f45", "#e0bfa3", "#6e4a36", "#b8906f"];

  let ctx; let root; let canvas; let g; let raf; let dataTimer; let cams = []; let selected = null; let filter = "";
  let people = []; let nextId = 0; let lastT = 0; let line = { in: 0, out: 0 }; let heat = null; let noise = null; let noiseTick = 0;
  const opts = { boxes: true, trails: true, roi: true, heat: false, anon: true };
  const VIDEO_ID = "VIDEO-DEMO";
  let demo = null; let video = null; let videoLoading = false; let userPicked = false;
  const isVideo = () => selected?.camera_id === VIDEO_ID;
  const $ = (sel) => root.querySelector(sel);

  /* ------------------------------------------------------------ perspectiva */
  const f = (d) => 1 / (1 + 2.6 * d);
  const fy = (d) => VY + (H - VY) * f(d);          // chão
  const cy = (d) => VY - (VY + 70) * f(d);         // teto
  const fx = (X, d) => VX + X * 560 * f(d);

  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  const hash = (str) => { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  function sceneOf(cam) {
    if (!cam) return "corredor";
    if (cam.sector === "acesso") return "entrada";
    if (cam.floor === "P2" && cam.sector === "alimentacao") return "praca";
    return "corredor";
  }

  function neighbours(cam) {
    const z = ctx.zonesByCode[cam.zone];
    return ctx.MALL.zones
      .filter((o) => o.floor === z.floor && o.code !== z.code && !["circulacao", "acesso"].includes(o.sector) && !o.code.includes("MESAS"))
      .sort((a, b) => Math.hypot(a.x - z.x, a.y - z.y) - Math.hypot(b.x - z.x, b.y - z.y))
      .slice(0, 6).map((o) => o.name);
  }

  /* ---------------------------------------------------------------- pessoas */
  function seatSpots() {
    const spots = [];
    [0.14, 0.32, 0.52, 0.74].forEach((d) => [-0.62, -0.21, 0.21, 0.62].forEach((X) => spots.push({ X: X - 0.07, d }, { X: X + 0.07, d: d + 0.02 })));
    return spots;
  }

  function spawn(r, scene, fromEdge = true) {
    const seatedShare = scene === "praca" ? 0.6 : 0;
    const seated = r() < seatedShare;
    const toward = r() < 0.5;
    const p = {
      id: nextId += 1 + Math.floor(r() * 3),
      X: (r() * 1.5 - 0.75), d: fromEdge ? (toward ? 1.02 : -0.06) : r() * 0.95,
      vd: (toward ? -1 : 1) * (0.035 + r() * 0.04), vx: (r() - 0.5) * 0.03,
      shirt: SHIRTS[Math.floor(r() * SHIRTS.length)], pants: r() < 0.5 ? "#2b3138" : "#3d4654", skin: SKIN[Math.floor(r() * SKIN.length)],
      hv: 0.88 + r() * 0.22, phase: r() * Math.PI * 2, conf: 0.78 + r() * 0.2, trail: [], seated: false, leaving: false,
    };
    if (seated) {
      const spot = seatSpots()[Math.floor(r() * 32)];
      Object.assign(p, { seated: true, X: spot.X, d: spot.d, vd: 0, vx: 0 });
    }
    return p;
  }

  function target() {
    if (!selected) return 0;
    return Math.min(sceneOf(selected) === "praca" ? 22 : 18, selected.people_in_view);
  }

  function step(dt, r) {
    const scene = sceneOf(selected);
    const goal = target();
    const active = people.filter((p) => !p.leaving).length;
    if (active < goal && r() < dt * 2.5) people.push(spawn(r, scene, people.length > 0));
    if (active > goal) { const p = people.find((q) => !q.leaving); if (p) { p.leaving = true; if (p.seated) { p.seated = false; p.vd = 0.05; } } }

    people.forEach((p) => {
      if (p.seated) { p.phase += dt; return; }
      const before = p.d;
      p.d += p.vd * dt; p.X += p.vx * dt; p.phase += dt * 7;
      if (Math.abs(p.X) > 0.85) p.vx = -p.vx;
      if (before > 0.3 && p.d <= 0.3) line.in += 1;
      if (before < 0.3 && p.d >= 0.3) line.out += 1;
      const foot = [fx(p.X, p.d), fy(p.d)];
      p.trail.push(foot); if (p.trail.length > 40) p.trail.shift();
      if (heat) {
        const gx = Math.floor((foot[0] / W) * heat.w); const gy = Math.floor((foot[1] / H) * heat.h);
        if (gx >= 0 && gx < heat.w && gy >= 0 && gy < heat.h) heat.v[gy * heat.w + gx] += dt * 3;
      }
    });
    people = people.filter((p) => {
      const out = p.d < -0.1 || p.d > 1.08;
      if (out && !p.leaving && people.length <= goal + 2) { Object.assign(p, spawn(r, scene, true), { seated: false }); return true; }
      return !out;
    });
    if (heat) for (let i = 0; i < heat.v.length; i += 1) heat.v[i] *= 1 - dt * 0.05;
  }

  /* ----------------------------------------------------------------- cenário */
  function quad(pts, fill) { g.beginPath(); g.moveTo(...pts[0]); pts.slice(1).forEach((p) => g.lineTo(...p)); g.closePath(); g.fillStyle = fill; g.fill(); }

  function drawScene(scene, names) {
    // teto
    const ceil = g.createLinearGradient(0, 0, 0, VY); ceil.addColorStop(0, "#2b2a27"); ceil.addColorStop(1, "#4a4740");
    g.fillStyle = ceil; g.fillRect(0, 0, W, H);
    // paredes laterais
    quad([[fx(-1, 0), fy(0)], [fx(-1, 1), fy(1)], [fx(-1, 1), cy(1)], [fx(-1, 0), cy(0)]], "#5a564d");
    quad([[fx(1, 0), fy(0)], [fx(1, 1), fy(1)], [fx(1, 1), cy(1)], [fx(1, 0), cy(0)]], "#5a564d");
    // chão (porcelanato claro com rejunte)
    const fl = g.createLinearGradient(0, fy(1), 0, H); fl.addColorStop(0, "#8d887d"); fl.addColorStop(1, "#b9b2a3");
    quad([[fx(-1, 0), H], [fx(1, 0), H], [fx(1, 1), fy(1)], [fx(-1, 1), fy(1)]], fl);
    g.strokeStyle = "rgba(60,55,48,0.25)"; g.lineWidth = 1;
    for (let d = 0; d <= 1; d += 0.08) { g.beginPath(); g.moveTo(fx(-1, d), fy(d)); g.lineTo(fx(1, d), fy(d)); g.stroke(); }
    for (let X = -1; X <= 1.001; X += 0.25) { g.beginPath(); g.moveTo(fx(X, 0), fy(0)); g.lineTo(fx(X, 1), fy(1)); g.stroke(); }
    // reflexo das luminárias no chão
    for (let d = 0.1; d < 1; d += 0.22) {
      g.fillStyle = "rgba(255,248,225,0.10)";
      g.beginPath(); g.ellipse(VX, fy(d) - 4 * f(d), 90 * f(d), 10 * f(d), 0, 0, Math.PI * 2); g.fill();
    }
    // vitrines nas paredes
    const segs = [[0.0, 0.22], [0.26, 0.5], [0.54, 0.76], [0.8, 0.98]];
    segs.forEach(([a, b], i) => [-1, 1].forEach((side, k) => {
      const name = names[(i * 2 + k) % Math.max(1, names.length)] || "LOJA";
      const top = (d) => cy(d) + (fy(d) - cy(d)) * 0.28; const bot = (d) => fy(d) - (fy(d) - cy(d)) * 0.02;
      const glass = g.createLinearGradient(fx(side, a), 0, fx(side, b), 0);
      glass.addColorStop(0, "#7d8a8e"); glass.addColorStop(1, "#9aa7a8");
      quad([[fx(side, a), top(a)], [fx(side, b), top(b)], [fx(side, b), bot(b)], [fx(side, a), bot(a)]], glass);
      // letreiro
      const st = (d) => cy(d) + (fy(d) - cy(d)) * 0.17;
      quad([[fx(side, a), st(a)], [fx(side, b), st(b)], [fx(side, b), top(b)], [fx(side, a), top(a)]], "#23211e");
      const mid = (a + b) / 2; const size = Math.max(7, 26 * f(mid));
      g.save();
      g.beginPath(); g.moveTo(fx(side, a), st(a)); g.lineTo(fx(side, b), st(b)); g.lineTo(fx(side, b), top(b)); g.lineTo(fx(side, a), top(a)); g.clip();
      g.fillStyle = "#e9dfc6"; g.font = `600 ${size}px Manrope, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(name.toUpperCase(), fx(side, mid), (st(mid) + top(mid)) / 2);
      g.restore();
      // pilar entre lojas
      quad([[fx(side, b), cy(b)], [fx(side, b + 0.04), cy(b + 0.04)], [fx(side, b + 0.04), fy(b + 0.04)], [fx(side, b), fy(b)]], "#6c675c");
    }));
    // fundo
    const backTop = cy(1); const backBot = fy(1);
    if (scene === "entrada") {
      const sky = g.createLinearGradient(0, backTop, 0, backBot); sky.addColorStop(0, "#d9e3e6"); sky.addColorStop(1, "#f3efe2");
      g.fillStyle = sky; g.fillRect(fx(-1, 1), backTop, fx(1, 1) - fx(-1, 1), backBot - backTop);
      g.strokeStyle = "#3b3a36"; g.lineWidth = 3;
      for (let i = 0; i <= 4; i += 1) { const x = fx(-1, 1) + ((fx(1, 1) - fx(-1, 1)) * i) / 4; g.beginPath(); g.moveTo(x, backTop); g.lineTo(x, backBot); g.stroke(); }
      g.fillStyle = "#23211e"; g.fillRect(fx(-0.55, 1), backTop + 6, fx(0.55, 1) - fx(-0.55, 1), 18);
      g.fillStyle = "#e9dfc6"; g.font = "700 11px Manrope, sans-serif"; g.textAlign = "center"; g.fillText(selected.zone_name.toUpperCase(), VX, backTop + 19);
    } else {
      g.fillStyle = "#4e4a42"; g.fillRect(fx(-1, 1), backTop, fx(1, 1) - fx(-1, 1), backBot - backTop);
      g.fillStyle = "#706a5e"; g.fillRect(fx(-0.4, 1), backTop + (backBot - backTop) * 0.35, fx(0.4, 1) - fx(-0.4, 1), (backBot - backTop) * 0.65);
    }
    // luminárias do teto
    for (let d = 0.12; d < 1; d += 0.17) {
      g.fillStyle = "rgba(255,250,235,0.85)";
      const w = 70 * f(d); const y = cy(d) + (fy(d) - cy(d)) * 0.03;
      g.fillRect(VX - w / 2, y, w, Math.max(1.5, 5 * f(d)));
    }
    if (scene === "praca") drawTables();
  }

  function drawTables() {
    const tables = [];
    [0.14, 0.32, 0.52, 0.74].forEach((d) => [-0.62, -0.21, 0.21, 0.62].forEach((X) => tables.push({ X, d })));
    tables.sort((a, b) => b.d - a.d).forEach(({ X, d }) => {
      const x = fx(X, d); const y = fy(d); const s = f(d);
      g.fillStyle = "rgba(0,0,0,0.18)"; g.beginPath(); g.ellipse(x, y + 2, 52 * s, 9 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#4a3b2c"; g.fillRect(x - 3 * s, y - 34 * s, 6 * s, 34 * s);
      g.fillStyle = "#d8cdb6"; g.beginPath(); g.ellipse(x, y - 36 * s, 44 * s, 12 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#5f5446";
      [-1, 1].forEach((k) => g.fillRect(x + k * 56 * s - 9 * s, y - 30 * s, 18 * s, 30 * s));
    });
  }

  /* ---------------------------------------------------------- pessoa + overlay */
  function personBox(p) {
    const x = fx(p.X, p.d); const y = fy(p.d); const ph = 230 * f(p.d) * p.hv * (p.seated ? 0.62 : 1);
    const w = ph * (p.seated ? 0.62 : 0.4);
    return { x, y, ph, w, x1: x - w / 2, y1: y - ph, x2: x + w / 2, y2: y };
  }

  function drawPerson(p) {
    const { x, y, ph } = personBox(p);
    const full = p.seated ? ph / 0.62 : ph;
    g.fillStyle = "rgba(0,0,0,0.22)"; g.beginPath(); g.ellipse(x, y, full * 0.16, full * 0.035, 0, 0, Math.PI * 2); g.fill();
    const swing = p.seated ? 0 : Math.sin(p.phase) * full * 0.07;
    const hip = y - full * 0.47;
    g.strokeStyle = p.pants; g.lineCap = "round"; g.lineWidth = Math.max(2, full * 0.075);
    if (p.seated) {
      g.beginPath(); g.moveTo(x - full * 0.05, hip + full * 0.17); g.lineTo(x - full * 0.05, y - full * 0.02); g.stroke();
    } else {
      g.beginPath(); g.moveTo(x - full * 0.04, hip); g.lineTo(x - full * 0.04 + swing, y); g.stroke();
      g.beginPath(); g.moveTo(x + full * 0.04, hip); g.lineTo(x + full * 0.04 - swing, y); g.stroke();
    }
    const torsoTop = y - (p.seated ? full * 0.62 : full * 0.82); const torsoH = full * 0.38;
    g.fillStyle = p.shirt;
    g.beginPath(); g.roundRect(x - full * 0.12, torsoTop, full * 0.24, torsoH, full * 0.06); g.fill();
    g.strokeStyle = p.shirt; g.lineWidth = Math.max(1.5, full * 0.055);
    g.beginPath(); g.moveTo(x - full * 0.12, torsoTop + full * 0.05); g.lineTo(x - full * 0.15 - swing * 0.4, torsoTop + full * 0.32); g.stroke();
    g.beginPath(); g.moveTo(x + full * 0.12, torsoTop + full * 0.05); g.lineTo(x + full * 0.15 + swing * 0.4, torsoTop + full * 0.32); g.stroke();
    const hy = torsoTop - full * 0.075; const hr = full * 0.075;
    if (opts.anon) { // mosaico sobre a cabeça: o worker borra o rosto antes de qualquer exibição
      const cell = Math.max(2, hr * 0.7);
      for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1) {
        g.fillStyle = (i + j) % 2 ? "#8e8a82" : "#a39e94";
        g.fillRect(x + i * cell - cell / 2, hy + j * cell - cell / 2, cell, cell);
      }
    } else {
      g.fillStyle = p.skin; g.beginPath(); g.arc(x, hy, hr, 0, Math.PI * 2); g.fill();
    }
  }

  function drawOverlay(stamp) {
    // região monitorada (ROI) e linha de contagem
    if (opts.roi) {
      g.strokeStyle = "rgba(91,168,255,0.85)"; g.setLineDash([8, 6]); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(fx(-0.92, -0.02), fy(-0.02)); g.lineTo(fx(0.92, -0.02), fy(-0.02)); g.lineTo(fx(0.92, 0.97), fy(0.97)); g.lineTo(fx(-0.92, 0.97), fy(0.97)); g.closePath(); g.stroke();
      g.fillStyle = "rgba(91,168,255,0.06)"; g.fill();
      g.setLineDash([]); g.strokeStyle = "#f6b94a"; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(fx(-0.92, 0.3), fy(0.3)); g.lineTo(fx(0.92, 0.3), fy(0.3)); g.stroke();
      label(`LINHA DE CONTAGEM  ↓ ${line.in}  ↑ ${line.out}`, fx(-0.9, 0.3) + 4, fy(0.3) - 8, "#f6b94a", "#1b1606");
      label("ROI · zona monitorada", fx(-0.9, 0.97) + 2, fy(0.97) - 6, "#5ba8ff", "#08111c");
    }
    if (opts.heat && heat) {
      const cw = W / heat.w; const ch = H / heat.h;
      for (let j = 0; j < heat.h; j += 1) for (let i = 0; i < heat.w; i += 1) {
        const v = Math.min(1, heat.v[j * heat.w + i] / 6); if (v < 0.04) continue;
        g.fillStyle = v > 0.66 ? `rgba(255,93,82,${v * 0.55})` : v > 0.33 ? `rgba(246,185,74,${v * 0.55})` : `rgba(82,215,192,${v * 0.5})`;
        g.fillRect(i * cw, j * ch, cw + 0.5, ch + 0.5);
      }
    }
    const ordered = [...people].sort((a, b) => b.d - a.d);
    ordered.forEach((p) => {
      if (opts.trails && p.trail.length > 2) {
        g.strokeStyle = "rgba(185,244,75,0.45)"; g.lineWidth = 1.5; g.beginPath();
        p.trail.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      }
    });
    if (opts.boxes) ordered.forEach((p) => {
      const b = personBox(p);
      g.strokeStyle = "#b9f44b"; g.lineWidth = 1.6; g.strokeRect(b.x1, b.y1, b.w, b.ph);
      const c = 6;
      g.lineWidth = 3;
      [[b.x1, b.y1, 1, 1], [b.x2, b.y1, -1, 1], [b.x1, b.y2, 1, -1], [b.x2, b.y2, -1, -1]].forEach(([x, y, sx, sy]) => {
        g.beginPath(); g.moveTo(x, y + sy * c); g.lineTo(x, y); g.lineTo(x + sx * c, y); g.stroke();
      });
      if (b.ph > 95) label(`#${p.id} pessoa ${p.conf.toFixed(2)}`, b.x1, b.y1 - 3, "#b9f44b", "#0f1a06");
      else if (b.ph > 55) label(`#${p.id}`, b.x1, b.y1 - 3, "#b9f44b", "#0f1a06");
    });
    // HUD
    g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(0, 0, W, 30); g.fillRect(0, H - 30, W, 30);
    g.font = "500 13px 'DM Mono', monospace"; g.textBaseline = "middle"; g.textAlign = "left";
    g.fillStyle = "#ff5d52"; g.beginPath(); g.arc(16, 15, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#f2efe6"; g.fillText(`${selected.camera_id}  ·  ${selected.zone_name}`, 28, 15);
    g.textAlign = "right"; g.fillText(stamp, W - 12, 15);
    g.textAlign = "left"; g.fillStyle = "#b9f44b";
    g.fillText(`PESSOAS NO QUADRO ${String(people.length).padStart(2, "0")}   ·   NA ZONA ${selected.people_in_view}`, 12, H - 15);
    g.textAlign = "right"; g.fillStyle = "#cfcabd";
    g.fillText("YOLOv8n + ByteTrack · 5 qps · borda · rostos anonimizados", W - 12, H - 15);
    g.fillStyle = "rgba(246,185,74,0.92)"; g.font = "600 11px Manrope, sans-serif"; g.textAlign = "center";
    g.fillText("CENA ILUSTRATIVA GERADA POR COMPUTADOR — NÃO É IMAGEM REAL DA CÂMERA", VX, 44);
  }

  function label(text, x, y, bg, fg) {
    g.font = "500 10px 'DM Mono', monospace"; g.textAlign = "left"; g.textBaseline = "alphabetic";
    const w = g.measureText(text).width + 8;
    g.fillStyle = bg; g.fillRect(x, y - 12, w, 14);
    g.fillStyle = fg; g.fillText(text, x + 4, y - 1);
  }

  function cctv() {
    if (!noise || noiseTick++ % 4 === 0) {
      noise = document.createElement("canvas"); noise.width = W / 4; noise.height = H / 4;
      const n = noise.getContext("2d"); const img = n.createImageData(noise.width, noise.height);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 18; }
      n.putImageData(img, 0, 0);
    }
    g.drawImage(noise, 0, 0, W, H);
    const vig = g.createRadialGradient(VX, H / 2, H * 0.35, VX, H / 2, H * 0.95);
    vig.addColorStop(0, "rgba(0,0,0,0)"); vig.addColorStop(1, "rgba(0,0,0,0.45)");
    g.fillStyle = vig; g.fillRect(0, 0, W, H);
  }

  /* -------------------------------------------- vídeo real processado (demonstração) */
  function loadDemo() {
    if (demo || videoLoading) return;
    videoLoading = true;
    const s = document.createElement("script");
    s.src = "assets/videos/demo.js";
    s.onload = () => {
      demo = window.FLUXO_VIDEO_DEMO || null; videoLoading = false;
      if (!root || !demo) return;
      if (!userPicked) select(VIDEO_ID); else renderList(); // a tela abre no vídeo real
    };
    s.onerror = () => { videoLoading = false; };
    document.head.append(s);
  }

  function ensureVideo() {
    if (video) return video;
    video = document.createElement("video");
    Object.assign(video, { muted: true, loop: true, playsInline: true, preload: "auto" });
    if (location.protocol.startsWith("http")) video.crossOrigin = "anonymous"; // permite exportar o quadro em PNG
    video.src = `assets/videos/${demo.video}`;
    video.addEventListener("timeupdate", syncVideoUi);
    return video;
  }

  const frameIndex = () => Math.min(demo.frames - 1, Math.max(0, Math.floor(video.currentTime * demo.fps)));

  function drawVideo() {
    const v = ensureVideo();
    if (v.readyState >= 2) g.drawImage(v, 0, 0, W, H);
    else { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.fillStyle = "#cfcabd"; g.font = "500 14px Manrope"; g.textAlign = "center"; g.fillText("Carregando vídeo…", VX, H / 2); }
    const fi = frameIndex();
    const tracks = demo.tracks[fi] || [];
    const [entries, exits, inRoi] = demo.counts[fi] || [0, 0, 0];
    if (opts.roi) {
      g.strokeStyle = "rgba(91,168,255,0.9)"; g.setLineDash([8, 6]); g.lineWidth = 1.5; g.beginPath();
      demo.roi.forEach(([x, y], i) => (i ? g.lineTo(x * W, y * H) : g.moveTo(x * W, y * H))); g.closePath(); g.stroke();
      g.fillStyle = "rgba(91,168,255,0.06)"; g.fill(); g.setLineDash([]);
      const [[ax, ay], [bx, by]] = demo.line;
      g.strokeStyle = "#f6b94a"; g.lineWidth = 2.5; g.beginPath(); g.moveTo(ax * W, ay * H); g.lineTo(bx * W, by * H); g.stroke();
      label(`LINHA DE CONTAGEM  ↓ ${entries}  ↑ ${exits}`, ax * W + 4, ay * H - 8, "#f6b94a", "#1b1606");
    }
    if (opts.heat && heat && !video.paused) tracks.forEach(([, x1, , x2, y2]) => {
      const gx = Math.floor(((x1 + x2) / 2) * heat.w); const gy = Math.floor(y2 * heat.h);
      if (gx >= 0 && gx < heat.w && gy >= 0 && gy < heat.h) heat.v[gy * heat.w + gx] += 0.25;
    });
    if (opts.heat && heat) {
      const cw = W / heat.w; const ch = H / heat.h;
      for (let j = 0; j < heat.h; j += 1) for (let i = 0; i < heat.w; i += 1) {
        const val = Math.min(1, heat.v[j * heat.w + i] / 6); if (val < 0.04) continue;
        g.fillStyle = val > 0.66 ? `rgba(255,93,82,${val * 0.55})` : val > 0.33 ? `rgba(246,185,74,${val * 0.55})` : `rgba(82,215,192,${val * 0.5})`;
        g.fillRect(i * cw, j * ch, cw + 0.5, ch + 0.5);
      }
    }
    if (opts.trails) {
      const from = Math.max(0, fi - 30);
      tracks.forEach(([id]) => {
        g.strokeStyle = "rgba(185,244,75,0.55)"; g.lineWidth = 1.5; g.beginPath(); let started = false;
        for (let k = from; k <= fi; k += 1) {
          const t = demo.tracks[k]?.find((b) => b[0] === id); if (!t) continue;
          const x = ((t[1] + t[3]) / 2) * W; const y = t[4] * H;
          if (started) g.lineTo(x, y); else { g.moveTo(x, y); started = true; }
        }
        g.stroke();
      });
    }
    if (opts.boxes) tracks.forEach(([id, x1, y1, x2, y2, conf]) => {
      const bx = x1 * W; const by = y1 * H; const bw = (x2 - x1) * W; const bh = (y2 - y1) * H;
      g.strokeStyle = "#b9f44b"; g.lineWidth = 1.6; g.strokeRect(bx, by, bw, bh);
      if (bh > 70) label(`#${id} pessoa ${conf.toFixed(2)}`, bx, by - 3, "#b9f44b", "#0f1a06");
      else if (bh > 30) label(`#${id}`, bx, by - 3, "#b9f44b", "#0f1a06");
    });
    g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(0, 0, W, 30); g.fillRect(0, H - 30, W, 30);
    g.font = "500 13px 'DM Mono', monospace"; g.textBaseline = "middle"; g.textAlign = "left";
    g.fillStyle = video.paused ? "#7c9a90" : "#ff5d52"; g.beginPath(); g.arc(16, 15, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#f2efe6"; g.fillText(`${demo.label}`, 28, 15);
    g.textAlign = "right"; g.fillText(`${video.currentTime.toFixed(1).padStart(4, "0")}s / ${demo.summary.seconds}s · quadro ${fi + 1}`, W - 12, 15);
    g.textAlign = "left"; g.fillStyle = "#b9f44b";
    g.fillText(`PESSOAS NO QUADRO ${String(tracks.length).padStart(2, "0")}   ·   NA ROI ${inRoi}`, 12, H - 15);
    g.textAlign = "right"; g.fillStyle = "#cfcabd"; g.fillText(`${demo.model} · detecção real · rostos borrados no arquivo`, W - 12, H - 15);
    liveStats(tracks.length, entries, exits, inRoi);
  }

  function liveStats(n, entries, exits, inRoi) {
    const set = (id, v) => { const el = root.querySelector(id); if (el && el.textContent !== String(v)) el.textContent = v; };
    set("#vdNow", n); set("#vdIn", entries); set("#vdOut", exits); set("#vdRoi", inRoi);
  }

  function syncVideoUi() {
    const bar = root?.querySelector("#vdSeek"); const btn = root?.querySelector("#vdPlay");
    if (bar && video?.duration) bar.value = String(Math.round((video.currentTime / video.duration) * 1000));
    if (btn) btn.textContent = video?.paused ? "▶ Reproduzir" : "❚❚ Pausar";
  }

  let names = [];
  const random = rng(Date.now());
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (document.hidden || !selected) return;
    if (isVideo()) { g.save(); drawVideo(); g.restore(); return; }
    const dt = Math.min(0.05, (t - (lastT || t)) / 1000); lastT = t;
    step(dt, random);
    const scene = sceneOf(selected);
    g.save();
    drawScene(scene, names);
    [...people].sort((a, b) => b.d - a.d).forEach(drawPerson);
    cctv();
    const at = ctx.refAt();
    const secs = Math.floor(t / 1000) % 60;
    drawOverlay(`${at.slice(8, 10)}/${at.slice(5, 7)}/${at.slice(0, 4)}  ${at.slice(11, 16)}:${String(secs).padStart(2, "0")}`);
    g.restore();
  }

  /* ------------------------------------------------------------------- UI */
  function build() {
    root.innerHTML = `
      <header class="panel-head">
        <div><p class="eyebrow">CÂMERAS · VISÃO COMPUTACIONAL</p><h2>Detecção e rastreio anônimo por câmera</h2></div>
        <span class="timestamp" id="vsRef">—</span>
      </header>
      <div class="vs-layout">
        <aside class="panel-card vs-list">
          <label class="vs-search"><svg><use href="#i-search"/></svg><input type="search" id="vsSearch" placeholder="Filtrar câmera ou zona" aria-label="Filtrar câmeras"></label>
          <div id="vsCams" class="vs-cams" role="listbox" aria-label="Câmeras"></div>
        </aside>
        <section class="vs-main">
          <div class="vs-frame"><canvas id="vsCanvas" width="${W}" height="${H}" role="img" aria-label="Cena ilustrativa da câmera com caixas de detecção de pessoas"></canvas></div>
          <div class="vs-transport" id="vdTransport" hidden>
            <button class="ghost-button" type="button" id="vdPlay">❚❚ Pausar</button>
            <input type="range" id="vdSeek" min="0" max="1000" value="0" aria-label="Posição do vídeo">
          </div>
          <div class="vs-controls" role="group" aria-label="Camadas da visão">
            <label><input type="checkbox" data-opt="boxes" checked> Caixas + id</label>
            <label><input type="checkbox" data-opt="trails" checked> Trilhas</label>
            <label><input type="checkbox" data-opt="roi" checked> ROI + linha</label>
            <label><input type="checkbox" data-opt="heat"> Calor do quadro</label>
            <label><input type="checkbox" data-opt="anon" checked> Anonimizar rostos</label>
            <button class="ghost-button" type="button" id="vsExport">Baixar quadro (PNG)</button>
          </div>
          <div class="vs-stats" id="vsStats"></div>
          <p class="panel-hint vs-note">Os números acima vêm do backend (eventos que as câmeras enviam). A cena é uma ilustração do ambiente com a mesma sobreposição que o <code>vision/worker.py</code> calcula em tempo real (YOLO detecta pessoas, ByteTrack mantém o id entre quadros, a linha virtual conta entradas e saídas). Nenhum quadro real sai da câmera.</p>
        </section>
      </div>`;
    canvas = $("#vsCanvas"); g = canvas.getContext("2d");
    $("#vdPlay").addEventListener("click", () => { if (!video) return; if (video.paused) video.play(); else video.pause(); syncVideoUi(); });
    $("#vdSeek").addEventListener("input", (e) => { if (video?.duration) { video.currentTime = (Number(e.target.value) / 1000) * video.duration; if (heat) heat.v.fill(0); } });
    $("#vsSearch").addEventListener("input", (e) => { filter = e.target.value.trim().toLocaleLowerCase("pt-BR"); renderList(); });
    root.querySelectorAll("[data-opt]").forEach((c) => c.addEventListener("change", () => { opts[c.dataset.opt] = c.checked; if (c.dataset.opt === "heat" && c.checked) heat = { w: 48, h: 27, v: new Float32Array(48 * 27) }; }));
    $("#vsExport").addEventListener("click", () => {
      canvas.toBlob((blob) => {
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
        a.download = `visao-${selected?.camera_id || "camera"}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
    });
    root.dataset.ready = "1";
  }

  function renderList() {
    const { fmt, esc, floorShort } = ctx;
    const max = Math.max(1, ...cams.map((c) => c.people_in_view));
    const shown = cams.filter((c) => !filter || `${c.zone_name} ${c.camera_id} ${c.zone}`.toLocaleLowerCase("pt-BR").includes(filter));
    const groups = ["T", "P2"].map((fl) => [fl, shown.filter((c) => c.floor === fl)]).filter(([, l]) => l.length);
    const videoItem = demo && (!filter || `vídeo video demonstração ${demo.label}`.toLocaleLowerCase("pt-BR").includes(filter))
      ? `<p class="eyebrow vs-group">VÍDEO REAL · DEMONSTRAÇÃO</p>
         <button type="button" role="option" class="vs-cam vs-video${isVideo() ? " active" : ""}" data-id="${VIDEO_ID}" aria-selected="${isVideo()}">
           <span class="vs-dot rec"></span>
           <span class="vs-cam-text"><b>${esc(demo.label)}</b><small>${demo.summary.seconds}s · ${demo.summary.unique_tracks} pessoas rastreadas</small></span>
           <span class="vs-cam-count">▶</span>
         </button>` : "";
    $("#vsCams").innerHTML = videoItem + groups.map(([fl, list]) => `<p class="eyebrow vs-group">${floorShort[fl].toUpperCase()} · ${list.length} câmeras</p>` + list.map((c) => `
      <button type="button" role="option" class="vs-cam${selected?.camera_id === c.camera_id ? " active" : ""}" data-id="${esc(c.camera_id)}" aria-selected="${selected?.camera_id === c.camera_id}">
        <span class="vs-dot${c.last_detection ? "" : " idle"}"></span>
        <span class="vs-cam-text"><b>${esc(c.zone_name)}</b><small>${esc(c.camera_id)}</small></span>
        <span class="vs-cam-count">${fmt(c.people_in_view)}<i style="width:${(c.people_in_view / max) * 100}%"></i></span>
      </button>`).join("")).join("") || '<p class="muted">Nenhuma câmera encontrada</p>';
    root.querySelectorAll(".vs-cam").forEach((b) => b.addEventListener("click", () => { userPicked = true; select(b.dataset.id); }));
  }

  function select(id) {
    if (id === VIDEO_ID && demo) {
      selected = { camera_id: VIDEO_ID, zone_name: demo.label, video: true };
      people = []; if (heat) heat.v.fill(0);
      const v = ensureVideo(); v.currentTime = 0; v.play().catch(() => {});
      renderList(); renderStats(); return;
    }
    if (video && !video.paused) video.pause();
    const cam = cams.find((c) => c.camera_id === id);
    if (!cam) return;
    const changed = selected?.camera_id !== id;
    selected = cam;
    if (changed) {
      names = neighbours(cam); people = []; line = { in: 0, out: 0 }; nextId = 100 + (hash(id) % 800);
      if (heat) heat.v.fill(0);
      const r = rng(hash(id));
      const n = target();
      for (let i = 0; i < n; i += 1) people.push(spawn(r, sceneOf(cam), false));
    }
    renderList(); renderStats();
  }

  function renderStats() {
    if (!selected) return;
    $("#vdTransport").hidden = !isVideo();
    root.querySelector('[data-opt="anon"]').disabled = isVideo();
    if (isVideo()) {
      const s = demo.summary;
      $("#vsStats").innerHTML = `
        <div class="vs-stat"><span>PESSOAS NO QUADRO</span><b id="vdNow">0</b></div>
        <div class="vs-stat in"><span>CRUZARAM A LINHA ↓</span><b id="vdIn">0</b></div>
        <div class="vs-stat out"><span>CRUZARAM A LINHA ↑</span><b id="vdOut">0</b></div>
        <div class="vs-stat"><span>NA ROI (CONFIRMADAS)</span><b id="vdRoi">0</b></div>
        <div class="vs-stat wide"><span>RESUMO DO VÍDEO · ${ctx.esc(demo.model)}</span>
          <b>${s.unique_tracks} pessoas rastreadas (ids únicos) · máx. ${s.max_in_frame} e média ${String(s.avg_in_frame).replace(".", ",")} por quadro · ${s.seconds}s, ${demo.frames} quadros</b></div>
        <div class="vs-stat wide warn"><span>ORIGEM</span><b>${ctx.esc(demo.source_note)}</b></div>`;
      return;
    }
    const { fmt, esc, sectorsByCode, floorShort } = ctx; const c = selected;
    const last = c.last_detection ? c.last_detection.slice(11, 16) : "—";
    $("#vsStats").innerHTML = `
      <div class="vs-stat"><span>PESSOAS NA ZONA AGORA</span><b>${fmt(c.people_in_view)}</b></div>
      <div class="vs-stat in"><span>ENTRADAS · ÚLTIMA HORA</span><b>${fmt(c.entries_last_hour)}</b></div>
      <div class="vs-stat out"><span>SAÍDAS · ÚLTIMA HORA</span><b>${fmt(c.exits_last_hour)}</b></div>
      <div class="vs-stat"><span>ÚLTIMA DETECÇÃO</span><b>${last}</b></div>
      <div class="vs-stat wide"><span>ZONA</span><b>${esc(c.zone_name)} · ${floorShort[c.floor]} · ${esc(sectorsByCode[c.sector].name)}</b>
        <button class="text-button" type="button" id="vsMap">ver no mapa de calor →</button></div>`;
    $("#vsMap").addEventListener("click", () => ctx.showOnMap(c.zone));
  }

  async function load() {
    try {
      const at = ctx.refAt();
      const res = await ctx.source.cameras(at);
      cams = res.cameras;
      $("#vsRef").textContent = `${at.slice(8, 10)}/${at.slice(5, 7)} ${at.slice(11, 16)} · ${cams.length} câmeras`;
      const keep = selected && cams.find((c) => c.camera_id === selected.camera_id);
      if (isVideo()) { renderList(); } else if (keep) { selected = keep; renderList(); renderStats(); } else {
        const first = cams.find((c) => c.zone === "P2-MESAS-CENTRO") || cams[0];
        select(first.camera_id);
      }
    } catch (err) { ctx.handleError(err); }
  }

  V.vision = {
    mount(c) {
      ctx = c; root = document.querySelector('[data-panel="vision"]');
      if (!root.dataset.ready) build();
      loadDemo();
      if (isVideo() && video) video.play().catch(() => {});
      load();
      clearInterval(dataTimer); dataTimer = setInterval(load, 15000);
      cancelAnimationFrame(raf); lastT = 0; raf = requestAnimationFrame(frame);
    },
    unmount() { clearInterval(dataTimer); cancelAnimationFrame(raf); if (video) video.pause(); },
    refresh() { load(); },
    select(id) { select(id); },
  };
})();
