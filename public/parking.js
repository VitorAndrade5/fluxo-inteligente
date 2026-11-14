/* Estacionamento inteligente: cada vaga verde (livre) ou vermelha (ocupada), como os
 * sistemas de orientação de vagas por luz. Dados: GET /api/parking e /api/parking/history.
 * O estado de cada vaga vem das câmeras do estacionamento (vision/worker.py, modo
 * "estacionamento") ou de sensores; no MVP, do simulador. */
(() => {
  "use strict";
  const V = (window.FluxoViews ||= {});
  const KIND_LABEL = { pne: "PNE", idoso: "60+", neurodiverso: "TEA", gestante: "G" };
  const KIND_NAME = { pne: "PNE", idoso: "Idoso", neurodiverso: "Neurodiverso", gestante: "Gestante e criança" };
  const STATE_LABEL = { livre: "VAGAS LIVRES", cheio: "QUASE CHEIO", lotado: "LOTADO" };

  let ctx; let root; let timer; let raf; let data = null; let hist = null; let histDate = null; let lotCode = "S1"; let prev = new Map();
  const $ = (sel) => root.querySelector(sel);

  function build() {
    root.innerHTML = `
      <header class="panel-head">
        <div><p class="eyebrow">ESTACIONAMENTO INTELIGENTE</p><h2>Vagas em tempo real · verde livre, vermelho ocupada</h2></div>
        <span class="timestamp" id="pkRef">—</span>
      </header>
      <div class="pk-reco" id="pkReco"></div>
      <div class="pk-signs" id="pkSigns"></div>
      <div class="panel-grid">
        <article class="panel-card span-2">
          <div class="card-head">
            <div class="pk-tabs" role="tablist" id="pkTabs"></div>
            <div class="pk-legend">
              <span><i class="pk-sw free"></i>Livre</span><span><i class="pk-sw occ"></i>Ocupada</span>
              <span><i class="pk-sw special"></i>Preferencial: PNE · 60+ · TEA (neurodiverso) · G (gestante)</span>
            </div>
          </div>
          <p class="panel-hint" id="pkLotHint"></p>
          <div class="pk-map" id="pkMap"></div>
        </article>
        <article class="panel-card">
          <h3>Ocupação ao longo do dia</h3>
          <p class="panel-hint">% de vagas ocupadas no fim de cada hora</p>
          <div id="pkChart" class="pk-chart"></div>
        </article>
        <article class="panel-card">
          <h3>Câmera do estacionamento · visão computacional</h3>
          <p class="panel-hint">Ilustração: o detector marca cada veículo e decide vaga a vaga se está ocupada. Mostra as primeiras vagas da última fileira do setor selecionado, com o estado real de cada uma.</p>
          <canvas id="pkCam" width="640" height="300" class="pk-cam" role="img" aria-label="Cena ilustrativa de câmera do estacionamento com vagas marcadas em verde e vermelho"></canvas>
        </article>
      </div>`;
    root.dataset.ready = "1";
  }

  async function load() {
    try {
      const at = ctx.refAt();
      const date = at.slice(0, 10);
      const jobs = [ctx.source.parking(at)];
      if (histDate !== date) jobs.push(ctx.source.parkingHistory(date));
      const [status, history] = await Promise.all(jobs);
      if (history) { hist = history; histDate = date; }
      data = status;
      render();
    } catch (err) { ctx.handleError(err); }
  }

  function render() {
    const { fmt, esc } = ctx;
    const at = data.at;
    $("#pkRef").textContent = `${at.slice(8, 10)}/${at.slice(5, 7)} ${at.slice(11, 16)} · ${fmt(data.totals.free)} de ${fmt(data.totals.total)} livres`;
    const r = data.recommended;
    $("#pkReco").innerHTML = r
      ? `<svg class="i"><use href="#i-car"/></svg><p><b>Melhor opção agora:</b> ${esc(r.name)} — ${fmt(r.free)} vagas livres. <span class="muted">Ocupação geral ${Math.round(data.totals.occupancy * 100)}%.</span></p>`
      : '<svg class="i"><use href="#i-alert"/></svg><p><b>Todos os setores lotados.</b></p>';
    $("#pkReco").className = `pk-reco ${r ? "" : "full"}`;

    $("#pkSigns").innerHTML = data.lots.map((l) => {
      const kinds = Object.entries(l.by_kind).filter(([k, v]) => k !== "comum" && v.total)
        .map(([k, v]) => `<span title="${KIND_NAME[k]}">${KIND_LABEL[k]} <b>${v.free}</b>/${v.total}</span>`).join("");
      return `<button type="button" class="pk-sign ${l.state}${l.code === lotCode ? " active" : ""}" data-lot="${l.code}">
        <span class="pk-sign-top"><b>${esc(l.name)}</b><small>${esc(l.level_label)}${l.is_estimate ? ' · <em title="Número de vagas não consta na planta">estimado</em>' : ""}</small></span>
        <span class="pk-led">${String(l.free).padStart(3, "0")}</span>
        <span class="pk-state">${STATE_LABEL[l.state]}</span>
        <span class="pk-kinds">${kinds}</span>
        <span class="pk-bar"><i style="width:${l.occupancy * 100}%"></i></span>
      </button>`;
    }).join("");
    root.querySelectorAll(".pk-sign").forEach((b) => b.addEventListener("click", () => { lotCode = b.dataset.lot; render(); }));

    $("#pkTabs").innerHTML = data.lots.map((l) => `<button type="button" role="tab" aria-selected="${l.code === lotCode}" class="${l.code === lotCode ? "active" : ""}" data-lot="${l.code}">${esc(l.name)}</button>`).join("");
    root.querySelectorAll("#pkTabs button").forEach((b) => b.addEventListener("click", () => { lotCode = b.dataset.lot; render(); }));

    const lot = data.lots.find((l) => l.code === lotCode) || data.lots[0];
    $("#pkLotHint").textContent = `${lot.name} · ${fmt(lot.total)} vagas${lot.is_estimate ? " (total estimado — a planta não informa)" : " (total da planta mix)"} · ${fmt(lot.free)} livres · ${fmt(lot.occupied)} ocupadas`;
    renderMap(lot);
    renderChart();
  }

  function renderMap(lot) {
    const sw = 22; const sh = 36; const gap = 3; const aisle = 26;
    const rowY = (r) => 10 + r * (sh + gap) + Math.floor(r / 2) * aisle;
    const width = 20 + lot.cols_count * (sw + gap);
    const height = rowY(lot.rows_count - 1) + sh + 14;
    let out = "";
    for (let r = 0; r < lot.rows_count; r += 2) {
      const y = rowY(r) + (r + 1 < lot.rows_count ? 2 * sh + gap : sh) + 4;
      out += `<rect class="pk-aisle" x="6" y="${y}" width="${width - 12}" height="${aisle - 8}" rx="4"/>`;
      out += `<text class="pk-aisle-label" x="12" y="${y + (aisle - 8) / 2 + 3}">CORREDOR ${String.fromCharCode(65 + r / 2)}</text>`;
    }
    lot.spaces.forEach((s) => {
      const x = 10 + s.col * (sw + gap); const y = rowY(s.row);
      const changed = prev.has(s.code) && prev.get(s.code) !== s.occupied;
      const cls = `pk-space ${s.occupied ? "occ" : "free"}${s.kind !== "comum" ? " special" : ""}${changed ? " flash" : ""}`;
      const ledY = s.row % 2 === 0 ? y + sh - 5 : y + 5; // luz do lado do corredor
      out += `<g class="${cls}"><title>${s.code} · ${s.kind === "comum" ? "vaga comum" : KIND_NAME[s.kind]} · ${s.occupied ? "ocupada" : "livre"}</title>
        <rect x="${x}" y="${y}" width="${sw}" height="${sh}" rx="3"/>
        ${s.occupied ? `<rect class="pk-car" x="${x + 4}" y="${y + 5}" width="${sw - 8}" height="${sh - 10}" rx="5"/>` : ""}
        <circle class="pk-led-dot" cx="${x + sw / 2}" cy="${ledY}" r="2.6"/>
        ${s.kind !== "comum" ? `<text class="pk-kind" x="${x + sw / 2}" y="${y + sh / 2 + 3}">${KIND_LABEL[s.kind]}</text>` : ""}</g>`;
    });
    $("#pkMap").innerHTML = `<svg viewBox="0 0 ${width} ${height}" style="max-width:${Math.round(width * 1.45)}px" role="img" aria-label="Mapa de vagas do ${lot.name}: ${lot.free} livres de ${lot.total}">${out}</svg>`;
    prev = new Map(data.lots.flatMap((l) => l.spaces.map((s) => [s.code, s.occupied])));
  }

  function renderChart() {
    if (!hist) return;
    const colors = { S1: "#b9f44b", S2: "#52d7c0", TN: "#f6b94a", TS: "#5ba8ff" };
    const W = 420; const H = 190; const m = { t: 10, r: 10, b: 24, l: 34 };
    const hours = hist.lots[Object.keys(hist.lots)[0]].map((p) => p.hour);
    const x = (h) => m.l + ((h - hours[0]) / (hours[hours.length - 1] - hours[0])) * (W - m.l - m.r);
    const y = (v) => m.t + (1 - v) * (H - m.t - m.b);
    let out = "";
    [0, 0.5, 1].forEach((v) => { out += `<line class="db-gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 3}" text-anchor="end">${v * 100}%</text>`; });
    hours.filter((h) => h % 3 === 0).forEach((h) => { out += `<text x="${x(h)}" y="${H - 6}" text-anchor="middle">${h}h</text>`; });
    const nowH = Number(data.at.slice(11, 13)) + Number(data.at.slice(14, 16)) / 60 - 1;
    if (nowH >= hours[0] && nowH <= hours[hours.length - 1]) out += `<line class="pk-now" x1="${x(nowH)}" x2="${x(nowH)}" y1="${m.t}" y2="${H - m.b}"/>`;
    Object.entries(hist.lots).forEach(([code, pts]) => {
      out += `<polyline fill="none" stroke="${colors[code] || "#fff"}" stroke-width="2" points="${pts.map((p) => `${x(p.hour).toFixed(1)},${y(p.occupancy).toFixed(1)}`).join(" ")}"/>`;
    });
    const legend = data.lots.map((l) => `<span><i style="background:${colors[l.code]}"></i>${ctx.esc(l.name)}</span>`).join("");
    $("#pkChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ocupação por hora de cada setor">${out}</svg><div class="pk-chart-legend">${legend}</div>`;
  }

  /* câmera ilustrativa: fileira de vagas em perspectiva com caixas verde/vermelho */
  function drawCam(t) {
    raf = requestAnimationFrame(drawCam);
    const canvas = $("#pkCam"); if (!canvas || !data || document.hidden) return;
    const g = canvas.getContext("2d"); const W = canvas.width; const H = canvas.height;
    const lot = data.lots.find((l) => l.code === lotCode) || data.lots[0];
    const camRow = lot.rows_count - 1;
    const row = lot.spaces.filter((s) => s.row === camRow).slice(0, 7);
    g.fillStyle = "#3b3c3a"; g.fillRect(0, 0, W, H);
    const floor = g.createLinearGradient(0, 70, 0, H); floor.addColorStop(0, "#4d4e4b"); floor.addColorStop(1, "#6b6c67");
    g.fillStyle = floor; g.fillRect(0, 70, W, H - 70);
    g.fillStyle = "#2a2b29"; g.fillRect(0, 0, W, 70);
    for (let i = 0; i < 6; i += 1) { g.fillStyle = "rgba(255,250,230,0.8)"; g.fillRect(40 + i * 110, 18, 60, 4); }
    const top = 110; const bot = 270; const n = row.length;
    const xt = (i) => 70 + i * ((W - 140) / n); const xb = (i) => 10 + i * ((W - 20) / n);
    row.forEach((s, i) => {
      g.strokeStyle = "#e8e4d6"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(xt(i), top); g.lineTo(xb(i), bot); g.stroke();
      if (i === n - 1) { g.beginPath(); g.moveTo(xt(i + 1), top); g.lineTo(xb(i + 1), bot); g.stroke(); }
      const cxm = (xt(i) + xt(i + 1) + xb(i) + xb(i + 1)) / 4;
      if (s.kind !== "comum") {
        g.fillStyle = "rgba(91,168,255,0.35)";
        g.beginPath(); g.moveTo(xt(i), top); g.lineTo(xt(i + 1), top); g.lineTo(xb(i + 1), bot); g.lineTo(xb(i), bot); g.fill();
        g.fillStyle = "#dfe9ff"; g.font = "700 14px Manrope, sans-serif"; g.textAlign = "center"; g.fillText(KIND_LABEL[s.kind], cxm, bot - 14);
      }
      if (s.occupied) {
        const h = 95; const y = bot - h - 20; const k = (y + h / 2 - top) / (bot - top); // centro da vaga na altura do carro
        const left = xt(i) + (xb(i) - xt(i)) * k; const right = xt(i + 1) + (xb(i + 1) - xt(i + 1)) * k;
        const w = (right - left) * 0.74; const x = (left + right) / 2 - w / 2;
        const hue = (s.code.charCodeAt(s.code.length - 1) * 37) % 360;
        g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.ellipse(cxm, bot - 18, w * 0.55, 10, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = `hsl(${hue} 12% ${30 + (hue % 30)}%)`; g.beginPath(); g.roundRect(x, y + 25, w, h - 25, 10); g.fill();
        g.fillStyle = "#1d2124"; g.beginPath(); g.roundRect(x + w * 0.12, y, w * 0.76, 40, 9); g.fill();
        g.fillStyle = "rgba(160,190,205,0.6)"; g.beginPath(); g.roundRect(x + w * 0.18, y + 6, w * 0.64, 22, 5); g.fill();
        g.fillStyle = "#f3e6b5"; g.fillRect(x + 6, y + h - 26, 12, 6); g.fillRect(x + w - 18, y + h - 26, 12, 6);
        g.strokeStyle = "#ff5d52"; g.lineWidth = 2.5; g.strokeRect(x - 4, y - 4, w + 8, h + 8);
        g.fillStyle = "#ff5d52"; g.fillRect(x - 4, y - 20, Math.min(92, w + 8), 16);
        g.fillStyle = "#1c0705"; g.font = "500 10px 'DM Mono', monospace"; g.textAlign = "left"; g.fillText(`carro ${(0.86 + (hue % 13) / 100).toFixed(2)}`, x, y - 8);
      }
      if (!s.occupied) { // vaga livre: o detector não encontra veículo no polígono da vaga
        g.strokeStyle = "#b9f44b"; g.lineWidth = 2.5; g.setLineDash([7, 5]);
        g.beginPath(); g.moveTo(xt(i) + 5, top + 18); g.lineTo(xt(i + 1) - 5, top + 18); g.lineTo(xb(i + 1) - 8, bot - 6); g.lineTo(xb(i) + 8, bot - 6); g.closePath(); g.stroke();
        g.setLineDash([]); g.fillStyle = "#b9f44b"; g.fillRect(cxm - 22, bot - 60, 44, 16);
        g.fillStyle = "#0f1a06"; g.font = "500 10px 'DM Mono', monospace"; g.textAlign = "center"; g.fillText("livre", cxm, bot - 48);
      }
      g.fillStyle = s.occupied ? "#ff5d52" : "#b9f44b";
      g.beginPath(); g.arc(cxm, 86, 7, 0, Math.PI * 2); g.fill();
      g.shadowColor = g.fillStyle; g.shadowBlur = 14; g.fill(); g.shadowBlur = 0;
      g.fillStyle = s.occupied ? "#ffb3ac" : "#dcf7b0"; g.font = "500 10px 'DM Mono', monospace"; g.textAlign = "center";
      g.fillText(s.code, cxm, 106);
    });
    g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(0, H - 22, W, 22);
    g.fillStyle = "#f2efe6"; g.font = "500 11px 'DM Mono', monospace"; g.textAlign = "left";
    const occ = row.filter((s) => s.occupied).length;
    g.fillText(`MNV-${lot.code}-CAM01 · ${lot.name} · fileira ${String.fromCharCode(65 + camRow)}: ${row.length - occ} livres / ${occ} ocupadas`, 10, H - 7);
    g.fillStyle = "rgba(246,185,74,0.92)"; g.textAlign = "right"; g.fillText("ILUSTRAÇÃO", W - 10, H - 7);
  }

  V.parking = {
    mount(c) {
      ctx = c; root = document.querySelector('[data-panel="parking"]');
      if (!root.dataset.ready) build();
      load();
      clearInterval(timer); timer = setInterval(load, 10000);
      cancelAnimationFrame(raf); raf = requestAnimationFrame(drawCam);
    },
    unmount() { clearInterval(timer); cancelAnimationFrame(raf); },
    refresh() { load(); },
  };
})();
