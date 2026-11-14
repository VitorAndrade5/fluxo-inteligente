/* Dashboard operacional: pessoas presentes, entradas/saídas, alertas de ocupação por área.
 * Adaptado do painel "Fluxo Capim Dourado" para a paleta do Fluxo Inteligente e
 * alimentado por GET /api/dashboard (ou pelo simulador no modo demonstração). */
(() => {
  "use strict";
  const V = (window.FluxoViews ||= {});
  const LIMIT_KEY = "fluxo-cd-limites";
  const DEFAULT_LIMIT = 75;
  const PERIOD_LABEL = { now: "nos últimos 15 min", hour: "na última hora", today: "hoje" };
  const SECTOR_ICON = { ancora: "bag", vestuario: "bag", alimentacao: "food", entretenimento: "film", servicos: "star", circulacao: "path", acesso: "door" };

  let ctx; let root; let timer; let period = "hour"; let snap = null; let lastOk = 0; let lastAlertKey = null;
  let limits = {};
  try { limits = JSON.parse(localStorage.getItem(LIMIT_KEY) || "{}") || {}; } catch { limits = {}; }
  const limitOf = (id) => Number(limits[id]) || DEFAULT_LIMIT;
  const $ = (sel) => root.querySelector(sel);
  const icon = (name, extra = "") => `<svg class="i" aria-hidden="true" ${extra}><use href="#i-${name}"/></svg>`;

  function levelOf(a) {
    const lim = limitOf(a.id);
    if (a.occupancyPercent >= lim) return { key: "crit", label: "Acima do limite", icon: "alert" };
    if (a.occupancyPercent >= lim - 10) return { key: "warn", label: "Atenção", icon: "dot" };
    return { key: "ok", label: "Normal", icon: "check" };
  }

  function build() {
    root.innerHTML = `
      <header class="panel-head">
        <div>
          <p class="eyebrow">DASHBOARD OPERACIONAL</p>
          <h2>Fluxo de pessoas · Capim Dourado Shopping</h2>
        </div>
        <span class="db-updated">Referência: <strong id="dbUpdated">—</strong></span>
      </header>

      <div class="db-banner demo" id="dbDemo" hidden>${icon("alert")}<p><strong>Dados simulados.</strong> Os números vêm do simulador do Fluxo Inteligente e não representam o movimento real do shopping. Com a integração das câmeras ativa, este aviso some.</p></div>
      <div class="db-banner crit" id="dbOffline" hidden role="alert">${icon("wifi-off")}<p><strong>Sem conexão com a internet.</strong> Os números exibidos são os últimos recebidos.</p></div>
      <div class="db-banner crit" id="dbError" hidden role="alert">${icon("alert")}<p><strong>Não foi possível obter os dados.</strong> <span id="dbErrorText"></span></p><button class="ghost-button" type="button" id="dbRetry">Tentar agora</button></div>
      <div class="db-banner warn" id="dbClosed" hidden>${icon("clock")}<p><strong>Fora do horário de funcionamento (10h–22h).</strong> Escolha uma hora na linha do tempo abaixo para ver o movimento do dia.</p></div>

      <div class="db-toolbar">
        <div class="db-seg" role="radiogroup" aria-label="Período">
          <button type="button" role="radio" data-period="now">Agora · 15 min</button>
          <button type="button" role="radio" data-period="hour">Última hora</button>
          <button type="button" role="radio" data-period="today">Hoje</button>
        </div>
        <span class="panel-hint" id="dbPeriodDesc"></span>
      </div>

      <section class="db-kpis" aria-label="Resumo">
        <article class="db-kpi"><span class="db-kpi-head">${icon("people")}Pessoas no shopping agora</span><strong id="kTotal">—</strong><small id="kTotalSub">&nbsp;</small></article>
        <article class="db-kpi in"><span class="db-kpi-head">${icon("in")}Entradas</span><strong id="kIn">—</strong><small id="kInSub">&nbsp;</small></article>
        <article class="db-kpi out"><span class="db-kpi-head">${icon("out")}Saídas</span><strong id="kOut">—</strong><small id="kOutSub">&nbsp;</small></article>
        <article class="db-kpi top"><span class="db-kpi-head">${icon("top")}Área mais movimentada</span><strong class="text" id="kTop">—</strong><small id="kTopSub">&nbsp;</small></article>
      </section>

      <section class="panel-card db-alerts" aria-labelledby="dbAlertsTitle">
        <div class="card-head"><h3 id="dbAlertsTitle">Alertas de ocupação</h3><span class="panel-hint">Disparam quando a ocupação de uma área atinge o limite definido.</span></div>
        <div class="db-chips" id="dbAlertList"></div>
        <div class="sr-only" id="dbAlertLive" aria-live="assertive"></div>
        <details class="db-limits">
          <summary>Configurar limites de alerta</summary>
          <div class="db-limits-grid" id="dbLimits"></div>
          <div class="db-limits-foot"><button class="ghost-button" type="button" id="dbLimitsReset">Restaurar padrão (75%)</button><span>Os limites ficam salvos apenas neste navegador.</span></div>
        </details>
      </section>

      <div class="panel-grid db-grid">
        <article class="panel-card">
          <div class="card-head"><h3>Áreas monitoradas</h3><button class="text-button" type="button" id="dbToMap">Ver no mapa de calor →</button></div>
          <p class="panel-hint">Setores do shopping · presença estimada pelas câmeras</p>
          <div class="db-tiles" id="dbTiles"></div>
          <div class="db-legend"><span class="lvl ok">${icon("check")}Normal</span><span class="lvl warn">${icon("dot")}Atenção (até 10 p.p. do limite)</span><span class="lvl crit">${icon("alert")}Acima do limite</span></div>
        </article>
        <article class="panel-card">
          <div class="card-head"><h3>Fluxo por horário</h3><span class="panel-hint">Entradas e saídas do shopping, hoje</span></div>
          <div class="db-legend"><span><i class="sw in"></i>Entradas</span><span><i class="sw out"></i>Saídas</span><span><i class="sw partial"></i>Hora em andamento</span></div>
          <div class="db-chart" id="dbHourly"></div>
        </article>
        <article class="panel-card">
          <div class="card-head"><h3>Comparação entre áreas</h3><span class="panel-hint" id="dbCmpDesc">Entradas e saídas no período</span></div>
          <div class="db-cmp" id="dbCmp"></div>
        </article>
        <article class="panel-card">
          <div class="card-head"><h3>Detalhe por área</h3><span class="panel-hint">Ordenado por pessoas presentes</span></div>
          <div class="matrix-wrap">
            <table class="ranking db-table">
              <caption class="sr-only">Pessoas presentes, entradas, saídas e ocupação de cada área</caption>
              <thead><tr><th scope="col">Área</th><th scope="col" class="r">Presentes</th><th scope="col" class="r">Entradas</th><th scope="col" class="r">Saídas</th><th scope="col">Ocupação</th></tr></thead>
              <tbody id="dbTable"></tbody>
            </table>
          </div>
        </article>
      </div>

      <footer class="db-footer">
        <p><strong>Privacidade (LGPD):</strong> o painel mostra apenas contagens agregadas e anônimas por área. As imagens das câmeras são processadas na própria borda (perto do gravador): nenhum quadro é gravado ou enviado, não há reconhecimento facial e o id de rastreio é um código que muda todo dia.</p>
        <p id="dbSource">Fonte: —</p>
      </footer>`;

    root.querySelectorAll("[data-period]").forEach((b) => b.addEventListener("click", () => { period = b.dataset.period; syncPeriod(); load(); }));
    $("#dbRetry").addEventListener("click", load);
    $("#dbToMap").addEventListener("click", () => document.querySelector('.nav-item[data-view="map"]').click());
    $("#dbLimits").addEventListener("change", (e) => {
      const inp = e.target.closest("input[data-id]"); if (!inp) return;
      const v = Math.min(100, Math.max(5, Math.round(Number(inp.value) || DEFAULT_LIMIT)));
      inp.value = v; limits[inp.dataset.id] = v;
      try { localStorage.setItem(LIMIT_KEY, JSON.stringify(limits)); } catch { /* sem storage */ }
      if (snap) render();
    });
    $("#dbLimitsReset").addEventListener("click", () => {
      limits = {}; try { localStorage.removeItem(LIMIT_KEY); } catch { /* sem storage */ }
      $("#dbLimits").dataset.ids = ""; if (snap) render();
    });
    window.addEventListener("online", () => { renderStatus(); load(); });
    window.addEventListener("offline", renderStatus);
    root.dataset.ready = "1";
    syncPeriod();
  }

  function syncPeriod() {
    root.querySelectorAll("[data-period]").forEach((b) => { const on = b.dataset.period === period; b.classList.toggle("active", on); b.setAttribute("aria-checked", String(on)); });
  }

  async function load() {
    if (!ctx?.source) return;
    try {
      snap = await ctx.source.dashboard(ctx.refAt(), period);
      lastOk = Date.now();
      $("#dbError").hidden = true;
      render();
    } catch (err) {
      if (err.status === 401) { ctx.handleError(err); return; }
      $("#dbErrorText").textContent = err.message;
      $("#dbError").hidden = false;
    }
    renderStatus();
  }

  function renderStatus() {
    if (!root) return;
    $("#dbOffline").hidden = navigator.onLine;
    $("#dbClosed").hidden = ctx.isOpenHours();
  }

  const fmtTime = (iso) => iso.slice(11, 16);
  const fmtDate = (iso) => iso.slice(0, 10).split("-").reverse().join("/");

  function render() {
    const s = snap; const { fmt, esc } = ctx;
    const lbl = PERIOD_LABEL[period];
    $("#dbDemo").hidden = !s.isDemo;
    $("#dbUpdated").textContent = `${fmtDate(s.updatedAt)} ${fmtTime(s.updatedAt)}`;
    $("#dbPeriodDesc").textContent = `${fmtTime(s.period.from)} até ${fmtTime(s.period.to)}`;
    $("#dbSource").textContent = ctx.mode === "api"
      ? `Fonte: API Fluxo Inteligente (${s.isDemo ? "eventos do simulador" : "eventos das câmeras"}) · atualizado às ${new Date(lastOk).toLocaleTimeString("pt-BR")}.`
      : "Fonte: simulador local no navegador (modo demonstração).";

    // KPIs
    $("#kTotal").textContent = fmt(s.totals.peoplePresent);
    const bal = s.totals.entries - s.totals.exits;
    $("#kTotalSub").textContent = `Saldo ${lbl}: ${bal >= 0 ? "+" : "−"}${fmt(Math.abs(bal))}`;
    $("#kIn").textContent = fmt(s.totals.entries);
    $("#kOut").textContent = fmt(s.totals.exits);
    $("#kInSub").textContent = $("#kOutSub").textContent = lbl.charAt(0).toUpperCase() + lbl.slice(1);
    const top = [...s.areas].sort((a, b) => b.peoplePresent - a.peoplePresent)[0];
    $("#kTop").textContent = top ? top.name : "—";
    $("#kTopSub").textContent = top ? `${fmt(top.peoplePresent)} pessoas · ${top.occupancyPercent}% de ocupação` : "";

    // Alertas
    const over = s.areas.filter((a) => a.occupancyPercent >= limitOf(a.id)).sort((a, b) => b.occupancyPercent - a.occupancyPercent);
    $("#dbAlertList").innerHTML = over.length
      ? over.map((a) => `<span class="db-chip crit">${icon("alert")}${esc(a.name)}: ${a.occupancyPercent}% (limite ${limitOf(a.id)}%)</span>`).join("")
      : `<span class="db-chip ok">${icon("check")}Nenhuma área acima do limite</span>`;
    const key = over.map((a) => a.id).join(",");
    if (lastAlertKey !== null && key !== lastAlertKey) {
      $("#dbAlertLive").textContent = over.length ? `Alerta: ${over.map((a) => a.name).join(", ")} acima do limite de ocupação.` : "Todas as áreas estão abaixo do limite.";
    }
    lastAlertKey = key;
    document.querySelector("#alertCount").textContent = String(over.length);

    // Limites
    const grid = $("#dbLimits"); const ids = s.areas.map((a) => a.id).join();
    if (grid.dataset.ids !== ids) {
      grid.dataset.ids = ids;
      grid.innerHTML = s.areas.map((a) => `<label for="lim-${esc(a.id)}">${esc(a.name)}<span><input type="number" id="lim-${esc(a.id)}" data-id="${esc(a.id)}" min="5" max="100" step="5" value="${limitOf(a.id)}"> %</span></label>`).join("");
    }

    // Áreas
    $("#dbTiles").innerHTML = s.areas.map((a) => {
      const lv = levelOf(a);
      return `<div class="db-tile ${lv.key}" role="group" aria-label="${esc(a.name)}: ${fmt(a.peoplePresent)} pessoas, ${a.occupancyPercent}% de ocupação, ${lv.label}">
        <div class="db-tile-name"><span class="sector-dot" style="background:${a.color || "var(--muted)"}"></span>${icon(SECTOR_ICON[a.id] || "people")}<span>${esc(a.name)}</span></div>
        <div class="db-tile-count">${fmt(a.peoplePresent)}</div>
        <div class="db-tile-occ"><span class="lvl ${lv.key}">${icon(lv.icon)}${a.occupancyPercent}%</span><span class="muted">· cap. ${fmt(a.capacity)}</span></div>
      </div>`;
    }).join("");

    renderHourly(s);

    // Comparação
    $("#dbCmpDesc").textContent = `Entradas e saídas ${lbl}`;
    const rows = [...s.areas].sort((a, b) => b.entriesInPeriod - a.entriesInPeriod);
    const max = Math.max(1, ...rows.flatMap((a) => [a.entriesInPeriod, a.exitsInPeriod]));
    $("#dbCmp").innerHTML = rows.map((a) => `<div class="db-cmp-row">
      <div class="db-cmp-name">${esc(a.name)}</div>
      <div class="db-cmp-bars">
        <div class="db-cmp-bar"><span class="sr-only">Entradas</span><div class="db-track"><i class="in" style="width:${(a.entriesInPeriod / max) * 100}%"></i></div><b>${fmt(a.entriesInPeriod)}</b></div>
        <div class="db-cmp-bar"><span class="sr-only">Saídas</span><div class="db-track"><i class="out" style="width:${(a.exitsInPeriod / max) * 100}%"></i></div><b>${fmt(a.exitsInPeriod)}</b></div>
      </div></div>`).join("");

    // Tabela
    $("#dbTable").innerHTML = [...s.areas].sort((a, b) => b.peoplePresent - a.peoplePresent).map((a) => {
      const lv = levelOf(a);
      return `<tr class="${lv.key === "crit" ? "crit" : ""}"><td>${esc(a.name)}</td><td class="r">${fmt(a.peoplePresent)}</td><td class="r">${fmt(a.entriesInPeriod)}</td><td class="r">${fmt(a.exitsInPeriod)}</td>
        <td><span class="occ"><span class="progress"><i class="${lv.key}" style="width:${Math.min(100, a.occupancyPercent)}%"></i></span><span class="lvl ${lv.key}">${a.occupancyPercent}% · ${lv.label}</span></span></td></tr>`;
    }).join("");
  }

  function niceMax(v) { const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }

  function renderHourly(s) {
    const { fmt } = ctx; const pts = s.series.points; const el = $("#dbHourly");
    if (!pts.length) { el.innerHTML = '<p class="muted db-empty">Sem fluxo registrado até este horário.</p>'; return; }
    const W = 720; const H = 240; const m = { t: 14, r: 10, b: 30, l: 46 };
    const iw = W - m.l - m.r; const ih = H - m.t - m.b;
    const max = niceMax(Math.max(1, ...pts.flatMap((p) => [p.entries, p.exits])));
    const y = (v) => m.t + ih - (v / max) * ih;
    const bw = iw / pts.length; const barW = Math.max(2, Math.min(16, (bw - 6) / 2));
    let out = "";
    for (let i = 0; i <= 4; i += 1) {
      const v = (max / 4) * i; const yy = y(v).toFixed(1);
      out += `<line class="db-gridline" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/><text x="${m.l - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${fmt(v)}</text>`;
    }
    pts.forEach((p, i) => {
      const cx = m.l + i * bw + bw / 2; const part = p.partial ? " partial" : "";
      const h = Number(p.start.slice(11, 13));
      out += `<g><title>${h}h${p.partial ? " (em andamento)" : ""}: ${fmt(p.entries)} entradas, ${fmt(p.exits)} saídas</title>
        <rect class="db-bar in${part}" x="${(cx - barW - 1).toFixed(1)}" y="${y(p.entries).toFixed(1)}" width="${barW.toFixed(1)}" height="${(m.t + ih - y(p.entries)).toFixed(1)}" rx="2"/>
        <rect class="db-bar out${part}" x="${(cx + 1).toFixed(1)}" y="${y(p.exits).toFixed(1)}" width="${barW.toFixed(1)}" height="${(m.t + ih - y(p.exits)).toFixed(1)}" rx="2"/></g>
        <text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle">${h}h</text>`;
    });
    const peak = pts.reduce((a, b) => (b.entries > a.entries ? b : a));
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas e saídas por hora. Pico de entradas às ${Number(peak.start.slice(11, 13))}h, com ${fmt(peak.entries)} entradas.">${out}</svg>`;
  }

  V.dashboard = {
    mount(c) {
      ctx = c; root = document.querySelector('[data-panel="dashboard"]');
      if (!root.dataset.ready) build();
      renderStatus(); load();
      clearInterval(timer);
      timer = setInterval(load, 15000);
    },
    unmount() { clearInterval(timer); },
    refresh() { load(); },
  };
})();
