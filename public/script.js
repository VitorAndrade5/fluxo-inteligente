/* Fluxo Inteligente · painel de mapa de calor e jornadas do Capim Dourado Shopping.
 *
 * Fonte de dados:
 *   - API FastAPI (backend/) quando disponível: ?api=http://host:porta, a própria
 *     origem (se servido pelo backend) ou http://localhost:8000.
 *   - Modo demonstração: simulador local com o mesmo modelo do backend, usando
 *     data/mall.js (gerado do seed.sql). Mesmas formas de resposta da API.
 */
(() => {
  "use strict";

  const MALL = window.MALL_DATA;
  const OPEN_HOUR = 10;
  const CLOSE_HOUR = 22;
  const HOT = 0.8;
  const COLD = 0.25;
  const MALL_OFFSET_MIN = -180; // America/Araguaina (UTC-3, sem horário de verão)

  const zonesByCode = Object.fromEntries(MALL.zones.map((z) => [z.code, z]));
  const sectorsByCode = Object.fromEntries(MALL.sectors.map((s) => [s.code, s]));
  const floorsByCode = Object.fromEntries(MALL.floors.map((f) => [f.code, f]));
  const floorShort = { T: "Térreo", P2: "Piso 2" };
  const levelLabel = { hot: "HOTSPOT", moderate: "MODERADA", cold: "COLDSPOT" };

  const $ = (sel) => document.querySelector(sel);
  const nf = new Intl.NumberFormat("pt-BR");
  const fmt = (n) => nf.format(Math.round(n || 0));
  const pct = (v) => `${Math.round((v || 0) * 100)}%`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hourText = (h) => (h === null ? "Dia inteiro" : `${String(h).padStart(2, "0")}:00 – ${String(h + 1).padStart(2, "0")}:00`);
  const zoneName = (code) => zonesByCode[code]?.name ?? code;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pad2 = (n) => String(Math.floor(n)).padStart(2, "0");
  const DWELL_MID_MIN = { ancora: 16.5, vestuario: 10.5, alimentacao: 27.5, entretenimento: 45, servicos: 9, circulacao: 3, acesso: 2 };
  const PARKING_TARGET = { 9: 0.04, 10: 0.22, 11: 0.38, 12: 0.62, 13: 0.70, 14: 0.58, 15: 0.52, 16: 0.56, 17: 0.66, 18: 0.82, 19: 0.92, 20: 0.90, 21: 0.70, 22: 0.35, 23: 0.05 };
  const PARKING_KINDS = ["comum", "pne", "idoso", "neurodiverso", "gestante"];
  /* "2026-11-14T19:45:00" -> { date, min } (minutos desde 00:00) */
  const splitAt = (at) => { const [date, time = "00:00:00"] = at.split("T"); const [h, m, sec = 0] = time.split(":").map(Number); return { date, min: h * 60 + m + sec / 60 }; };
  const isoAt = (date, min) => `${date}T${pad2(min / 60)}:${pad2(min % 60)}:${pad2((min * 60) % 60)}`;

  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* sem storage */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch { /* sem storage */ } },
  };

  function mallNow() {
    const d = new Date(Date.now() + (new Date().getTimezoneOffset() + MALL_OFFSET_MIN) * 60000);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { date, hour: d.getHours(), minute: d.getMinutes() };
  }

  /* =============================================================== API */
  class ApiClient {
    constructor(base) { this.base = base.replace(/\/$/, ""); this.token = null; }

    async request(path, { params, method = "GET", body } = {}) {
      const url = new URL(this.base + path);
      Object.entries(params || {}).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") url.searchParams.set(k, v); });
      const headers = { Accept: "application/json" };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      if (body) headers["Content-Type"] = "application/json";
      const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) {
        let detail = res.statusText;
        try { detail = (await res.json()).detail || detail; } catch { /* corpo vazio */ }
        const err = new Error(typeof detail === "string" ? detail : "Erro na API");
        err.status = res.status;
        throw err;
      }
      return res.json();
    }

    static async probe(base, timeout = 2500) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(`${base.replace(/\/$/, "")}/api/health`, { signal: ctrl.signal });
        if (!res.ok) return null;
        const data = await res.json();
        return data.status === "ok" ? data : null;
      } catch { return null; } finally { clearTimeout(timer); }
    }

    login(email, password) { return this.request("/api/auth/login", { method: "POST", body: { email, password } }); }
    me() { return this.request("/api/auth/me"); }
    heatmap(floor, date, hour) { return this.request("/api/heatmap", { params: { floor, date, hour } }); }
    timeline(date, floor) { return this.request("/api/heatmap/timeline", { params: { date, floor } }).then((r) => r.hours); }
    summary(date, hour) { return this.request("/api/metrics/summary", { params: { date, hour } }); }
    dwell(date, floor) { return this.request("/api/metrics/dwell", { params: { date, floor } }); }
    transitions(date, hour, from_zone, to_zone, limit = 10) { return this.request("/api/journeys/transitions", { params: { date, hour, from_zone, to_zone, limit } }); }
    sectorMatrix(date, hour) { return this.request("/api/journeys/sector-matrix", { params: { date, hour } }); }
    pathsTo(zone, date, limit = 5) { return this.request(`/api/journeys/paths-to/${encodeURIComponent(zone)}`, { params: { date, limit } }); }
    sectorFlow(sector, date, limit = 6) { return this.request(`/api/journeys/sector/${encodeURIComponent(sector)}`, { params: { date, limit } }); }
    dashboard(at, period) { return this.request("/api/dashboard", { params: { at, period } }); }
    cameras(at) { return this.request("/api/cameras", { params: { at } }); }
    parking(at) { return this.request("/api/parking", { params: { at } }); }
    parkingHistory(date) { return this.request("/api/parking/history", { params: { date } }); }
  }

  /* ========================================== modo demonstração (local) */
  function mulberry32(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class DemoBackend {
    constructor(visitors = 3000) { this.visitors = visitors; this.cache = new Map(); }

    events(date) {
      if (!this.cache.has(date)) this.cache.set(date, this.simulate(date));
      return this.cache.get(date);
    }

    /* Mesmo modelo de backend/app/services/simulator.py */
    simulate(date) {
      const seed = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
      const rnd = mulberry32(seed);
      const randint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
      const uniform = (a, b) => a + rnd() * (b - a);
      const choice = (items, weights) => {
        const total = weights.reduce((s, w) => s + w, 0);
        let r = rnd() * total;
        for (let i = 0; i < items.length; i += 1) { r -= weights[i]; if (r <= 0) return items[i]; }
        return items[items.length - 1];
      };
      const zones = MALL.zones.map((z) => ({ ...z, aspect: floorsByCode[z.floor].aspect_ratio }));
      const entrances = zones.filter((z) => z.is_entrance);
      const arrivals = { 10: 3, 11: 5, 12: 9, 13: 9, 14: 6, 15: 5, 16: 6, 17: 7, 18: 9, 19: 10, 20: 8, 21: 4 };
      const dwell = { ancora: [8, 25], vestuario: [5, 16], alimentacao: [15, 40], entretenimento: [20, 70], servicos: [4, 14], circulacao: [1, 5], acesso: [1, 3] };
      const meal = (h) => [12, 13, 19, 20].includes(h);
      const boost = (z, h) => {
        let b = 1;
        if (z.sector === "alimentacao" && meal(h)) b *= 2.2;
        if (z.connects_to && z.floor === "P2") b *= 0.45;
        if (z.connects_to && z.floor === "T" && meal(h)) b *= 2;
        if (z.code === "T-CINEMARK" && h >= 17) b *= 2.4;
        if (z.sector === "entretenimento" && h >= 15) b *= 1.3;
        if ((z.sector === "ancora" || z.sector === "vestuario") && h >= 15 && h <= 18) b *= 1.3;
        return b;
      };
      const next = (here, h, visited, cameFrom) => {
        const cand = []; const w = [];
        zones.forEach((z) => {
          if (z.code === here.code || z.is_entrance || z.floor !== here.floor) return;
          const d = Math.hypot((z.x - here.x) * z.aspect, z.y - here.y);
          let weight = z.attractiveness * boost(z, h) * Math.exp(-d / 22);
          if (visited.has(z.code)) weight *= 0.25;
          cand.push(z); w.push(weight);
        });
        if (here.connects_to && cameFrom !== here.connects_to) {
          cand.push(zonesByCode[here.connects_to]); w.push(w.reduce((s, x) => s + x, 0) * 1.5);
        }
        return choice(cand, w);
      };
      const pick = (opts) => choice(opts, opts.map((z) => z.attractiveness));
      const foodStores = zones.filter((z) => z.floor === "P2" && z.sector === "alimentacao" && !z.code.includes("MESAS"));
      const tables = zones.filter((z) => z.code.includes("MESAS"));

      const events = [];
      const close = CLOSE_HOUR * 60 + 30;
      const hours = Object.keys(arrivals).map(Number);
      const hw = Object.values(arrivals);
      const push = (v, from, to, t) => events.push({ v, from, to, t });

      for (let i = 0; i < this.visitors; i += 1) {
        const h0 = choice(hours, hw);
        let t = h0 * 60 + randint(0, 59) + rnd();
        let here = choice(entrances, entrances.map((z) => z.attractiveness));
        push(i, null, here.code, t);
        const visited = new Set([here.code]);
        let cameFrom = null;
        const goals = [];
        if (rnd() < ([11, 12, 13, 18, 19, 20].includes(h0) ? 0.55 : 0.18)) {
          goals.push(zonesByCode["T-ESC-CENTRAL"], zonesByCode["P2-ESC"], pick(foodStores), pick(tables));
        }
        if (rnd() < (h0 >= 16 ? 0.3 : 0.08)) {
          if (goals.length) goals.push(zonesByCode["P2-ESC"], zonesByCode["T-ESC-CENTRAL"]);
          goals.push(zonesByCode["T-CINEMARK"]);
        }
        const goalAt = randint(0, 2);
        const steps = randint(3, 8) + goals.length;
        for (let s = 0; s < steps; s += 1) {
          let [lo, hi] = dwell[here.sector];
          if (here.code === "T-CINEMARK") [lo, hi] = [95, 150];
          t += uniform(lo, hi);
          if (t >= close) break;
          let nxt;
          if (goals.length && s >= goalAt && goals[0].code !== here.code) nxt = goals.shift();
          else {
            if (goals.length && goals[0].code === here.code) goals.shift();
            nxt = next(here, Math.floor(t / 60), visited, cameFrom);
          }
          push(i, here.code, nxt.code, t);
          cameFrom = here.code; here = nxt; visited.add(here.code);
        }
        if (here.floor === "P2" && t < close) {
          ["P2-ESC", "T-ESC-CENTRAL"].forEach((code) => {
            if (here.code === code) return;
            t += uniform(1, 4); push(i, here.code, code, t); here = zonesByCode[code];
          });
        }
        if (t < close && !here.is_entrance) {
          const exit = entrances.reduce((a, b) => (Math.hypot(a.x - here.x, a.y - here.y) <= Math.hypot(b.x - here.x, b.y - here.y) ? a : b));
          t += uniform(1, 5); push(i, here.code, exit.code, t);
        }
      }
      return events;
    }

    inWindow(e, hour) { return hour === null || hour === undefined || Math.floor(e.t / 60) === hour; }

    async heatmap(floor, date, hour) {
      const counts = {};
      this.events(date).forEach((e) => { if (this.inWindow(e, hour)) counts[e.to] = (counts[e.to] || 0) + 1; });
      const hours = hour === null ? CLOSE_HOUR - OPEN_HOUR : 1;
      const list = MALL.zones.filter((z) => z.floor === floor);
      const peak = Math.max(1, ...list.map((z) => counts[z.code] || 0));
      const zones = list.map((z) => {
        const entries = counts[z.code] || 0;
        const occupancy = entries / (z.capacity_hour * hours);
        return {
          code: z.code, name: z.name, store_ref: z.store_ref, sector: z.sector, x: z.x, y: z.y, radius: z.radius,
          capacity_hour: z.capacity_hour, entries, occupancy, intensity: entries / peak,
          level: occupancy >= HOT ? "hot" : occupancy <= COLD ? "cold" : "moderate",
        };
      }).sort((a, b) => b.entries - a.entries);
      return {
        floor, date, hour, zones,
        total_entries: zones.reduce((s, z) => s + z.entries, 0),
        hotspots: zones.filter((z) => z.level === "hot").length,
        coldspots: zones.filter((z) => z.level === "cold").length,
      };
    }

    async timeline(date, floor) {
      const counts = {};
      this.events(date).forEach((e) => {
        if (floor && zonesByCode[e.to].floor !== floor) return;
        const h = Math.floor(e.t / 60); counts[h] = (counts[h] || 0) + 1;
      });
      const out = [];
      for (let h = OPEN_HOUR; h <= CLOSE_HOUR; h += 1) out.push({ hour: h, entries: counts[h] || 0 });
      return out;
    }

    async summary(date, hour) {
      const evs = this.events(date).filter((e) => this.inWindow(e, hour));
      const [t, p2] = await Promise.all([this.heatmap("T", date, hour), this.heatmap("P2", date, hour)]);
      const zones = [...t.zones, ...p2.zones];
      const busiest = zones.reduce((a, b) => (b.occupancy > a.occupancy ? b : a), zones[0]);
      const tl = await this.timeline(date, null);
      const peak = tl.reduce((a, b) => (b.entries > a.entries ? b : a), tl[0]);
      return {
        date, hour, events: evs.length, visitors: new Set(evs.map((e) => e.v)).size,
        hotspots: t.hotspots + p2.hotspots, coldspots: t.coldspots + p2.coldspots, zones_monitored: zones.length,
        busiest_zone: busiest, peak_hour: peak.entries ? peak : null,
        by_floor: { T: t.total_entries, P2: p2.total_entries },
      };
    }

    async dwell(date, floor) {
      const acc = {};
      const evs = this.events(date);
      for (let i = 0; i < evs.length - 1; i += 1) {
        const a = evs[i]; const b = evs[i + 1];
        if (a.v !== b.v) continue;
        if (floor && zonesByCode[a.to].floor !== floor) continue;
        (acc[a.to] ||= []).push(b.t - a.t);
      }
      return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10]));
    }

    async transitions(date, hour, fromZone, toZone, limit = 10) {
      const counts = new Map();
      this.events(date).forEach((e) => {
        if (!e.from || !this.inWindow(e, hour)) return;
        if (fromZone && e.from !== fromZone) return;
        if (toZone && e.to !== toZone) return;
        const k = `${e.from}>${e.to}`; counts.set(k, (counts.get(k) || 0) + 1);
      });
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, total]) => {
        const [f, t] = k.split(">");
        return { from_code: f, from_name: zoneName(f), to_code: t, to_name: zoneName(t), from_floor: zonesByCode[f].floor, to_floor: zonesByCode[t].floor, total };
      });
    }

    async sectorMatrix(date, hour) {
      const codes = MALL.sectors.map((s) => s.code);
      const matrix = Object.fromEntries(codes.map((a) => [a, Object.fromEntries(codes.map((b) => [b, 0]))]));
      this.events(date).forEach((e) => {
        if (!e.from || !this.inWindow(e, hour)) return;
        matrix[zonesByCode[e.from].sector][zonesByCode[e.to].sector] += 1;
      });
      return { sectors: MALL.sectors, matrix };
    }

    sequences(date) {
      const seqs = new Map();
      this.events(date).forEach((e) => { if (!seqs.has(e.v)) seqs.set(e.v, []); seqs.get(e.v).push(e.to); });
      return [...seqs.values()];
    }

    async pathsTo(zone, date, limit = 5) {
      const counts = new Map();
      this.sequences(date).forEach((seq) => seq.forEach((z, i) => {
        if (z !== zone || i === 0) return;
        const key = seq.slice(Math.max(0, i - 3), i).join(">"); counts.set(key, (counts.get(key) || 0) + 1);
      }));
      const paths = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, total]) => ({ steps: [...k.split(">"), zone], total }));
      return { zone: { code: zone, name: zoneName(zone) }, paths };
    }

    async sectorFlow(sector, date, limit = 6) {
      const origins = new Map(); const dests = new Map();
      this.sequences(date).forEach((seq) => seq.forEach((z, i) => {
        if (zonesByCode[z].sector !== sector) return;
        const prev = seq[i - 1]; const nxt = seq[i + 1];
        if (prev && zonesByCode[prev].sector !== sector) origins.set(prev, (origins.get(prev) || 0) + 1);
        if (nxt && zonesByCode[nxt].sector !== sector) dests.set(nxt, (dests.get(nxt) || 0) + 1);
      }));
      const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([code, total]) => ({ code, name: zoneName(code), total }));
      return { sector: { code: sector, name: sectorsByCode[sector].name }, origins: top(origins), destinations: top(dests) };
    }

    /* ---- dashboard operacional (mesmas regras de analytics.dashboard) ---- */
    presence(date, atMin) {
      const last = new Map();
      this.events(date).forEach((e) => { if (e.t <= atMin) last.set(e.v, e); });
      const out = {};
      last.forEach((e) => {
        if (e.t < atMin - 150) return;
        if (zonesByCode[e.to].is_entrance && e.from) return;
        out[e.to] = (out[e.to] || 0) + 1;
      });
      return out;
    }

    async dashboard(at, period) {
      const { date, min: atMin } = splitAt(at);
      const startMin = period === "today" ? 0 : Math.max(0, atMin - (period === "now" ? 15 : 60));
      const present = {}; const capacity = {}; const entries = {}; const exits = {};
      MALL.sectors.forEach((s) => { present[s.code] = 0; capacity[s.code] = 0; entries[s.code] = 0; exits[s.code] = 0; });
      const byZone = this.presence(date, atMin);
      MALL.zones.forEach((z) => { capacity[z.sector] += (z.capacity_hour * DWELL_MID_MIN[z.sector]) / 60; present[z.sector] += byZone[z.code] || 0; });
      let mallIn = 0; let mallOut = 0;
      const firstHour = Math.min(OPEN_HOUR, Math.floor(atMin / 60));
      const series = {};
      this.events(date).forEach((e) => {
        if (e.t >= atMin) return;
        const h = Math.floor(e.t / 60);
        const isIn = !e.from; const isOut = !!e.from && zonesByCode[e.to].is_entrance;
        if (h >= firstHour) { series[h] ||= { entries: 0, exits: 0 }; series[h].entries += isIn ? 1 : 0; series[h].exits += isOut ? 1 : 0; }
        if (e.t < startMin) return;
        mallIn += isIn ? 1 : 0; mallOut += isOut ? 1 : 0;
        const ts = zonesByCode[e.to].sector; const fs = e.from ? zonesByCode[e.from].sector : null;
        if (fs !== ts) { entries[ts] += 1; if (fs) exits[fs] += 1; }
      });
      const points = [];
      for (let h = firstHour; h * 60 <= atMin; h += 1) {
        points.push({ start: isoAt(date, h * 60), entries: series[h]?.entries || 0, exits: series[h]?.exits || 0, partial: (h + 1) * 60 > atMin });
      }
      const areas = MALL.sectors.map((s) => {
        const cap = Math.max(1, Math.round(capacity[s.code]));
        return { id: s.code, name: s.name, color: s.color, capacity: cap, peoplePresent: present[s.code],
          entriesInPeriod: entries[s.code], exitsInPeriod: exits[s.code], occupancyPercent: Math.round((present[s.code] / cap) * 100) };
      });
      return {
        updatedAt: at, isDemo: true, period: { key: period, from: isoAt(date, startMin), to: at },
        totals: { peoplePresent: areas.reduce((a, x) => a + x.peoplePresent, 0), entries: mallIn, exits: mallOut },
        areas, series: { bucket: "hour", points },
      };
    }

    async cameras(at) {
      const { date, min: atMin } = splitAt(at);
      const present = this.presence(date, atMin);
      const act = {};
      this.events(date).forEach((e) => {
        if (e.t > atMin || e.t < atMin - 60) return;
        (act[e.to] ||= { entries: 0, exits: 0, last: null }).entries += 1;
        act[e.to].last = Math.max(act[e.to].last ?? 0, e.t);
        if (e.from) (act[e.from] ||= { entries: 0, exits: 0, last: null }).exits += 1;
      });
      return {
        at,
        cameras: MALL.zones.map((z) => ({
          camera_id: z.camera_id, zone: z.code, zone_name: z.name, floor: z.floor, sector: z.sector, active: true,
          people_in_view: present[z.code] || 0, entries_last_hour: act[z.code]?.entries || 0, exits_last_hour: act[z.code]?.exits || 0,
          last_detection: act[z.code]?.last ? isoAt(date, act[z.code].last) : null, capacity_hour: z.capacity_hour,
        })),
      };
    }

    /* ---- estacionamento (mesmo modelo de services/parking.py) ---- */
    parkingLayout() {
      if (this.layout) return this.layout;
      let id = 0;
      this.layout = MALL.parking.map((lot) => {
        const spaces = [];
        for (let r = 0; r < lot.rows_count; r += 1) {
          for (let c = 0; c < lot.cols_count; c += 1) {
            const idx = r * lot.cols_count + c; id += 1;
            spaces.push({ id, code: `${lot.code}-${String.fromCharCode(65 + r)}${pad2(c + 1)}`, row: r, col: c, kind: lot.specials[idx] || "comum" });
          }
        }
        return { ...lot, spaces };
      });
      return this.layout;
    }

    parkingTimeline(date) {
      this.parkingCache ||= new Map();
      if (this.parkingCache.has(date)) return this.parkingCache.get(date);
      const seed = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
      const rnd = mulberry32(seed * 7919 + 17);
      const timeline = new Map(); // id da vaga -> [[minuto, ocupada], ...]
      this.parkingLayout().forEach((lot) => lot.spaces.forEach((sp) => {
        const pref = lot.preference * (sp.kind !== "comum" ? 0.55 : 1);
        const evs = []; let until = null;
        for (let t = 9 * 60; t < 23 * 60 + 30; t += 5) {
          if (until !== null && t >= until) { evs.push([until, 0]); until = null; }
          if (until === null) {
            const p = Math.min(0.97, (PARKING_TARGET[Math.floor(t / 60)] || 0) * pref);
            const rate = p > 0 ? p / ((1 - p) * 110) : 0;
            if (rnd() < rate * 5) {
              const arrive = t + rnd() * 5;
              const stay = t < 17 * 60 ? 35 + rnd() * 155 : 60 + rnd() * 150;
              until = Math.min(arrive + stay, 23 * 60 + 30);
              evs.push([arrive, 1]);
            }
          }
        }
        if (until !== null) evs.push([until, 0]);
        timeline.set(sp.id, evs);
      }));
      this.parkingCache.set(date, timeline);
      return timeline;
    }

    occupiedAt(evs, atMin) {
      let occ = 0;
      for (const [t, o] of evs) { if (t > atMin) break; occ = o; }
      return occ === 1;
    }

    async parking(at) {
      const { date, min: atMin } = splitAt(at);
      const timeline = this.parkingTimeline(date);
      const lots = this.parkingLayout().map((lot) => {
        const byKind = Object.fromEntries(PARKING_KINDS.map((k) => [k, { total: 0, free: 0 }]));
        let occupied = 0;
        const spaces = lot.spaces.map((sp) => {
          const occ = this.occupiedAt(timeline.get(sp.id), atMin);
          occupied += occ ? 1 : 0; byKind[sp.kind].total += 1; byKind[sp.kind].free += occ ? 0 : 1;
          return { code: sp.code, row: sp.row, col: sp.col, kind: sp.kind, occupied: occ };
        });
        const free = lot.total - occupied; const occupancy = Math.round((occupied / lot.total) * 1000) / 1000;
        return { code: lot.code, name: lot.name, level_label: lot.level_label, total: lot.total, rows_count: lot.rows_count,
          cols_count: lot.cols_count, is_estimate: !!lot.is_estimate, free, occupied, occupancy, by_kind: byKind, spaces,
          state: free <= Math.max(2, lot.total * 0.03) ? "lotado" : occupancy >= 0.85 ? "cheio" : "livre" };
      });
      const total = lots.reduce((a, l) => a + l.total, 0); const free = lots.reduce((a, l) => a + l.free, 0);
      const best = lots.filter((l) => l.state !== "lotado").sort((a, b) => b.free / b.total - a.free / a.total)[0];
      return { at, lots, totals: { total, free, occupied: total - free, occupancy: Math.round(((total - free) / total) * 1000) / 1000 },
        recommended: best ? { code: best.code, name: best.name, free: best.free } : null };
    }

    async parkingHistory(date) {
      const timeline = this.parkingTimeline(date);
      const lots = {};
      this.parkingLayout().forEach((lot) => {
        lots[lot.code] = [];
        for (let h = 9; h < 24; h += 1) {
          const occ = lot.spaces.filter((sp) => this.occupiedAt(timeline.get(sp.id), (h + 1) * 60 - 0.001)).length;
          lots[lot.code].push({ hour: h, occupancy: Math.round((occ / lot.total) * 1000) / 1000 });
        }
      });
      return { date, lots };
    }
  }

  /* ============================================================ estado */
  const state = {
    source: null,     // ApiClient | DemoBackend
    mode: "demo",     // "api" | "demo"
    floor: "T",
    date: mallNow().date,
    hour: null,
    view: "map",
    filter: "all",
    selected: null,
    heat: null,
    dwell: {},
    timeline: [],
    layers: { heat: true, zone: true, route: true, camera: false, plan: true },
    zoom: 1, panX: 0, panY: 0,
    box: { w: 0, h: 0 },
    heatValues: {},
    playing: null,
    pollTimer: null,
    requestId: 0,
  };

  const el = {
    login: $("#loginScreen"), loginForm: $("#loginForm"), loginEmail: $("#loginEmail"), loginPassword: $("#loginPassword"),
    loginError: $("#loginError"), loginApi: $("#loginApi"), loginSubmit: $("#loginSubmit"), demoButton: $("#demoButton"),
    app: $("#app"), stage: $("#mapStage"), canvasBox: $("#mapCanvas"), plan: $("#planImage"), heat: $("#heatCanvas"),
    routes: $("#routeLayer"), markers: $("#mapMarkers"), card: $("#zoneCard"), search: $("#mapSearch"),
    searchResults: $("#searchResults"), timeline: $("#timeline"), toast: $("#toast"), sidebar: $("#sidebar"),
    panel: $("#analysisPanel"),
  };

  let toastTimer;
  function toast(msg) {
    clearTimeout(toastTimer);
    el.toast.textContent = msg;
    el.toast.classList.add("visible");
    toastTimer = setTimeout(() => el.toast.classList.remove("visible"), 2800);
  }

  /* ====================================================== mapa e zoom */
  function fitMap() {
    const aspect = floorsByCode[state.floor].aspect_ratio;
    const W = el.stage.clientWidth; const H = el.stage.clientHeight;
    if (!W || !H) return;
    let w = W * 0.96; let h = w / aspect;
    if (h > H * 0.94) { h = H * 0.94; w = h * aspect; }
    state.box = { w, h };
    Object.assign(el.canvasBox.style, { width: `${w}px`, height: `${h}px`, left: `${(W - w) / 2}px`, top: `${(H - h) / 2}px` });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.heat.width = Math.round(w * dpr);
    el.heat.height = Math.round(h * dpr);
    drawHeat(state.heatValues);
  }

  function applyTransform() {
    el.canvasBox.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    $("#zoomLevel").textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function setZoom(v) {
    state.zoom = clamp(v, 0.8, 3);
    if (state.zoom <= 0.8) { state.panX = 0; state.panY = 0; }
    applyTransform();
  }

  /* ================================================== mapa de calor */
  const palette = (() => {
    const c = document.createElement("canvas"); c.width = 256; c.height = 1;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, "rgba(82,215,192,0)");
    g.addColorStop(0.18, "#52d7c0");
    g.addColorStop(0.45, "#b9f44b");
    g.addColorStop(0.7, "#f6b94a");
    g.addColorStop(1, "#ff5d52");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 1);
    return ctx.getImageData(0, 0, 256, 1).data;
  })();

  function heatValue(z) {
    if (!z.entries) return 0;
    return clamp(0.6 * Math.min(1, z.occupancy / 0.9) + 0.4 * z.intensity, 0.05, 1);
  }

  function drawHeat(values) {
    const canvas = el.heat; const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    if (!w || !h) return;
    MALL.zones.forEach((z) => {
      if (z.floor !== state.floor) return;
      const v = values[z.code] || 0;
      if (v <= 0.001) return;
      const r = Math.max(14, (z.radius / 100) * w * 1.55);
      const x = (z.x / 100) * w; const y = (z.y / 100) * h;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${v})`);
      g.addColorStop(0.55, `rgba(0,0,0,${v * 0.45})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    });
    const img = ctx.getImageData(0, 0, w, h); const px = img.data;
    for (let i = 3; i < px.length; i += 4) {
      const a = px[i];
      if (!a) continue;
      const p = a * 4;
      px[i - 3] = palette[p]; px[i - 2] = palette[p + 1]; px[i - 1] = palette[p + 2];
      px[i] = Math.min(235, a * 1.35);
    }
    ctx.putImageData(img, 0, 0);
  }

  let heatAnim;
  function animateHeat(target) {
    cancelAnimationFrame(heatAnim);
    const from = { ...state.heatValues };
    const t0 = performance.now();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = (now) => {
      const k = reduce ? 1 : Math.min(1, (now - t0) / 450);
      const e = 1 - (1 - k) ** 3;
      const cur = {};
      Object.keys({ ...from, ...target }).forEach((code) => { cur[code] = (from[code] || 0) + ((target[code] || 0) - (from[code] || 0)) * e; });
      state.heatValues = cur;
      drawHeat(cur);
      if (k < 1) heatAnim = requestAnimationFrame(step);
    };
    heatAnim = requestAnimationFrame(step);
  }

  /* =========================================================== marcadores */
  function renderMarkers() {
    const frag = document.createDocumentFragment();
    const byCode = Object.fromEntries((state.heat?.zones || []).map((z) => [z.code, z]));
    MALL.zones.filter((z) => z.floor === state.floor).forEach((z) => {
      const data = byCode[z.code];
      const level = data?.level || "cold";
      const b = document.createElement("button");
      b.type = "button";
      b.className = `map-marker ${level}${z.code === state.selected ? " active" : ""}`;
      b.dataset.mapLayer = "zone"; b.dataset.code = z.code; b.dataset.level = level;
      b.style.left = `${z.x}%`; b.style.top = `${z.y}%`;
      b.setAttribute("aria-label", `${z.name}: ${fmt(data?.entries)} passagens, ${pct(data?.occupancy)} de ocupação`);
      b.innerHTML = `<span class="marker-label">${esc(z.name)}<small>${fmt(data?.entries)} passagens · ${pct(data?.occupancy)}</small></span>`;
      b.addEventListener("click", (ev) => { ev.stopPropagation(); selectZone(z.code); });
      frag.append(b);

      const cam = document.createElement("span");
      cam.className = "map-marker camera-marker";
      cam.dataset.mapLayer = "camera";
      cam.style.left = `${z.x + 1.6}%`; cam.style.top = `${z.y - 2.2}%`;
      cam.title = z.camera_id;
      frag.append(cam);
    });
    el.markers.replaceChildren(frag);
    applyLayers();
    applyFilter();
  }

  function applyLayers() {
    Object.entries(state.layers).forEach(([layer, on]) => {
      document.querySelectorAll(`[data-map-layer='${layer}']`).forEach((n) => n.classList.toggle("hidden-layer", !on));
    });
  }

  function applyFilter() {
    document.querySelectorAll(".map-marker[data-map-layer='zone']").forEach((m) => {
      m.classList.toggle("filtered", state.filter !== "all" && m.dataset.level !== state.filter);
    });
  }

  /* ============================================================== rotas */
  async function renderRoutes() {
    const id = state.requestId;
    let flows;
    try {
      if (state.selected && zonesByCode[state.selected].floor === state.floor) {
        const [out, inc] = await Promise.all([
          state.source.transitions(state.date, state.hour, state.selected, null, 5),
          state.source.transitions(state.date, state.hour, null, state.selected, 4),
        ]);
        flows = [...out.map((f) => ({ ...f, dir: "out" })), ...inc.map((f) => ({ ...f, dir: "in" }))];
      } else {
        const top = await state.source.transitions(state.date, state.hour, null, null, 40);
        flows = top.filter((f) => f.from_floor === state.floor && f.to_floor === state.floor).slice(0, 8).map((f) => ({ ...f, dir: "out" }));
      }
    } catch (err) { return handleError(err); }
    if (id !== state.requestId) return;
    const max = Math.max(1, ...flows.map((f) => f.total));
    const ns = "http://www.w3.org/2000/svg";
    const frag = document.createDocumentFragment();
    flows.forEach((f, i) => {
      const a = zonesByCode[f.from_code]; const b = zonesByCode[f.to_code];
      if (!a || !b || a.floor !== state.floor || b.floor !== state.floor) return;
      const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
      const dx = b.x - a.x; const dy = b.y - a.y;
      const bend = (i % 2 ? -1 : 1) * 0.18;
      const d = `M${a.x} ${a.y} Q${mx - dy * bend} ${my + dx * bend} ${b.x} ${b.y}`;
      const width = 1.2 + 3.5 * (f.total / max);
      const under = document.createElementNS(ns, "path");
      under.setAttribute("d", d); under.setAttribute("class", "route-under"); under.setAttribute("stroke-width", width * 4);
      const dash = document.createElementNS(ns, "path");
      dash.setAttribute("d", d); dash.setAttribute("class", `route-dash${f.dir === "in" ? " inbound" : ""}`); dash.setAttribute("stroke-width", width);
      const title = document.createElementNS(ns, "title");
      title.textContent = `${f.from_name} → ${f.to_name}: ${fmt(f.total)}`;
      dash.append(title);
      frag.append(under, dash);
    });
    el.routes.replaceChildren(frag);
  }

  /* ======================================================== card da zona */
  async function selectZone(code, { focus = false } = {}) {
    const z = zonesByCode[code];
    if (!z) return;
    if (z.floor !== state.floor) { await setFloor(z.floor, { keepSelection: true }); }
    state.selected = code;
    document.querySelectorAll(".map-marker[data-map-layer='zone']").forEach((m) => m.classList.toggle("active", m.dataset.code === code));
    renderCard();
    renderRoutes();
    if (focus) {
      state.zoom = Math.max(state.zoom, 1.6);
      state.panX = (50 - z.x) / 100 * state.box.w * state.zoom;
      state.panY = (50 - z.y) / 100 * state.box.h * state.zoom;
      applyTransform();
    }
  }

  async function renderCard() {
    const code = state.selected;
    if (!code) { el.card.classList.add("closed"); return; }
    const z = zonesByCode[code];
    const data = state.heat?.zones.find((x) => x.code === code) || { entries: 0, occupancy: 0, level: "cold" };
    el.card.className = `incident-card ${data.level}`;
    const status = $("#zoneStatus");
    status.className = `incident-status ${data.level}`;
    status.innerHTML = `<i></i> ${levelLabel[data.level]}`;
    $("#zoneWindow").textContent = `${floorShort[z.floor]} · ${hourText(state.hour)}`;
    $("#zoneTitle").textContent = z.name;
    $("#zoneLocation").textContent = `${z.store_ref || ""} · ${sectorsByCode[z.sector].name}`;
    $("#zoneEntries").textContent = fmt(data.entries);
    $("#zoneOccupancy").textContent = pct(data.occupancy);
    const dw = state.dwell[code];
    $("#zoneDwell").textContent = dw ? `${dw.toFixed(0)} min` : "—";
    const list = $("#zoneDestinations");
    try {
      const flows = await state.source.transitions(state.date, state.hour, code, null, 3);
      if (state.selected !== code) return;
      list.innerHTML = flows.length
        ? flows.map((f) => `<li><span>${esc(f.to_name)}${f.to_floor !== z.floor ? ` <small class="muted">(${floorShort[f.to_floor]})</small>` : ""}</span><span>${fmt(f.total)}</span></li>`).join("")
        : '<li class="muted">Sem trajetos registrados no período</li>';
    } catch (err) { handleError(err); }
  }

  /* ============================================================= sidebar */
  function renderSummary(s) {
    $("#statVisitors").textContent = fmt(s.visitors);
    $("#statEvents").textContent = fmt(s.events);
    $("#statHot").textContent = fmt(s.hotspots);
    $("#statCold").textContent = fmt(s.coldspots);
    $("#statVisitorsMeta").textContent = state.hour === null ? "no dia" : "nesta hora";
    $("#periodLabel").textContent = `${state.date.split("-").reverse().join("/")} · ${state.hour === null ? "dia" : `${state.hour}h`}`;
    const b = s.busiest_zone;
    $("#statBusiest").textContent = b ? `${b.name}` : "—";
    const occ = b ? b.occupancy : 0;
    const bar = $("#statBusiestBar");
    bar.style.width = `${Math.min(100, occ * 100)}%`;
    bar.classList.toggle("hot", occ >= HOT);
    $("#statBusiestPct").textContent = pct(occ);
    $("#alertCount").textContent = s.hotspots;
    $("#navJourneys").textContent = fmt(s.events);
  }

  function renderCounts() {
    const zones = state.heat?.zones || [];
    $("#countAll").textContent = zones.length;
    $("#countHot").textContent = zones.filter((z) => z.level === "hot").length;
    $("#countModerate").textContent = zones.filter((z) => z.level === "moderate").length;
    $("#countCold").textContent = zones.filter((z) => z.level === "cold").length;
    $("#floorBadge").textContent = `${floorShort[state.floor].toUpperCase()} · ${hourText(state.hour).toUpperCase()}`;
  }

  /* ======================================================= linha do tempo */
  function renderTimeline() {
    const max = Math.max(1, ...state.timeline.map((h) => h.entries));
    const now = mallNow();
    el.timeline.replaceChildren(...state.timeline.map((h) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `hour-bar${state.hour === h.hour ? " active" : ""}${now.date === state.date && now.hour === h.hour ? " now" : ""}`;
      b.setAttribute("aria-label", `${h.hour}h: ${fmt(h.entries)} passagens`);
      b.setAttribute("aria-pressed", String(state.hour === h.hour));
      b.title = `${hourText(h.hour)} · ${fmt(h.entries)} passagens`;
      b.innerHTML = `<span class="bar-track"><span class="bar-fill" style="height:${Math.max(3, (h.entries / max) * 100)}%"></span></span><small>${h.hour}h</small>`;
      b.addEventListener("click", () => { stopPlay(); setHour(state.hour === h.hour ? null : h.hour); });
      return b;
    }));
    $("#hourLabel").textContent = hourText(state.hour);
    $("#wholeDay").classList.toggle("active", state.hour === null);
  }

  /* ================================================== painel de análise */
  function barList(items, label, value, cls = "") {
    const max = Math.max(1, ...items.map(value));
    return items.length
      ? items.map((it) => `<li><div class="row"><span>${label(it)}</span><span>${fmt(value(it))}</span></div><div class="bar ${cls}"><i style="width:${(value(it) / max) * 100}%"></i></div></li>`).join("")
      : '<li class="muted">Sem dados no período</li>';
  }

  async function renderJourneys() {
    const period = `${state.date.split("-").reverse().join("/")} · ${hourText(state.hour)}`;
    $("#journeyPeriod").textContent = period;
    const target = $("#pathTarget").value || "T-CINEMARK";
    const sector = $("#sectorSelect").value || "vestuario";
    try {
      const [top, paths, matrix, flow] = await Promise.all([
        state.source.transitions(state.date, state.hour, null, null, 10),
        state.source.pathsTo(target, state.date, 6),
        state.source.sectorMatrix(state.date, state.hour),
        state.source.sectorFlow(sector, state.date, 6),
      ]);
      $("#topTransitions").innerHTML = barList(top,
        (f) => `${esc(f.from_name)} → ${esc(f.to_name)}${f.from_floor !== f.to_floor ? '<span class="floor-tag">troca de piso</span>' : ""}`,
        (f) => f.total);
      $("#pathsTo").innerHTML = paths.paths.length
        ? paths.paths.map((p) => `<li><span class="path-steps">${p.steps.map((s) => `<span>${esc(zoneName(s))}</span>`).join("<em>›</em>")}</span><span class="path-count">${fmt(p.total)}</span></li>`).join("")
        : '<li class="muted">Nenhum caminho registrado até esta zona</li>';
      renderMatrix(matrix);
      $("#sectorOrigins").innerHTML = barList(flow.origins, (o) => esc(o.name), (o) => o.total, "");
      $("#sectorOrigins").classList.add("inbound");
      $("#sectorDestinations").innerHTML = barList(flow.destinations, (o) => esc(o.name), (o) => o.total);
    } catch (err) { handleError(err); }
  }

  function renderMatrix({ sectors, matrix }) {
    const max = Math.max(1, ...sectors.flatMap((a) => sectors.map((b) => matrix[a.code][b.code])));
    const head = `<thead><tr><th></th>${sectors.map((s) => `<th title="${esc(s.name)}">${esc(s.name.split(/[ /&]/)[0])}</th>`).join("")}</tr></thead>`;
    const body = sectors.map((a) => `<tr><th><span class="sector-dot" style="background:${a.color}"></span>${esc(a.name)}</th>${sectors.map((b) => {
      const v = matrix[a.code][b.code]; const k = v / max;
      const bg = v ? `rgba(246,185,74,${0.06 + k * 0.6})` : "rgba(255,255,255,0.02)";
      return `<td style="background:${bg};color:${k > 0.55 ? "#13200b" : "inherit"}" title="${esc(a.name)} → ${esc(b.name)}: ${fmt(v)}">${v ? fmt(v) : "·"}</td>`;
    }).join("")}</tr>`).join("");
    $("#sectorMatrix").innerHTML = head + `<tbody>${body}</tbody>`;
  }

  async function renderMetrics() {
    $("#metricsPeriod").textContent = `${state.date.split("-").reverse().join("/")} · ${hourText(state.hour)}`;
    try {
      const [t, p2, dwell, summary] = await Promise.all([
        state.source.heatmap("T", state.date, state.hour),
        state.source.heatmap("P2", state.date, state.hour),
        state.source.dwell(state.date, null),
        state.source.summary(state.date, state.hour),
      ]);
      $("#floorSplit").innerHTML = `<ol class="bar-list">${barList([
        { name: "Térreo", total: t.total_entries }, { name: "Piso 2 · Praça de Alimentação", total: p2.total_entries },
      ], (x) => x.name, (x) => x.total)}</ol>`;
      const peak = summary.peak_hour;
      $("#peakHour").textContent = peak ? `${peak.hour}h` : "—";
      $("#peakHourMeta").textContent = peak ? `${fmt(peak.entries)} passagens entre ${hourText(peak.hour)}` : "Sem dados";
      const zones = [...t.zones.map((z) => ({ ...z, floor: "T" })), ...p2.zones.map((z) => ({ ...z, floor: "P2" }))]
        .sort((a, b) => b.occupancy - a.occupancy);
      $("#zoneRanking tbody").innerHTML = zones.map((z) => `<tr data-code="${z.code}">
        <td>${esc(z.name)} <span class="level-pill ${z.level}">${levelLabel[z.level]}</span></td>
        <td>${floorShort[z.floor]}</td><td>${esc(sectorsByCode[z.sector].name)}</td><td>${fmt(z.entries)}</td>
        <td><span class="occ"><span class="progress"><i class="${z.level === "hot" ? "hot" : ""}" style="width:${Math.min(100, z.occupancy * 100)}%"></i></span>${pct(z.occupancy)}</span></td>
        <td>${dwell[z.code] ? `${Math.round(dwell[z.code])} min` : "—"}</td></tr>`).join("");
    } catch (err) { handleError(err); }
  }

  /* telas em módulos separados (dashboard.js, vision.js, parking.js) */
  const moduleView = (view) => window.FluxoViews?.[view];

  function setView(view) {
    if (state.view !== view) moduleView(state.view)?.unmount?.();
    state.view = view;
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
    el.panel.hidden = view === "map";
    el.panel.classList.toggle("wide-view", Boolean(moduleView(view)));
    document.querySelectorAll(".analysis-view").forEach((v) => { v.hidden = v.dataset.panel !== view; });
    if (view === "journeys") renderJourneys();
    if (view === "metrics") renderMetrics();
    moduleView(view)?.mount?.(ctx);
    if (window.innerWidth <= 820) el.sidebar.classList.remove("open");
  }

  /* instante de referência das telas operacionais: hora escolhida na linha do tempo, ou agora */
  function refAt() {
    const now = mallNow();
    if (state.hour !== null) {
      const minute = state.date === now.date && state.hour === now.hour ? now.minute : 59;
      return `${state.date}T${pad2(state.hour)}:${pad2(minute)}:00`;
    }
    if (state.date === now.date) return `${now.date}T${pad2(now.hour)}:${pad2(now.minute)}:00`;
    return `${state.date}T21:30:00`;
  }

  const ctx = {
    get source() { return state.source; },
    get mode() { return state.mode; },
    get date() { return state.date; },
    get hour() { return state.hour; },
    refAt, mallNow, toast, handleError, fmt, pct, esc, clamp, pad2, splitAt,
    MALL, zonesByCode, sectorsByCode, floorShort, OPEN_HOUR, CLOSE_HOUR,
    isOpenHours() { const m = splitAt(refAt()).min; return m >= OPEN_HOUR * 60 && m <= CLOSE_HOUR * 60 + 30; },
    setHour(h) { stopPlay(); setHour(h); },
    showOnMap(code) { setView("map"); selectZone(code, { focus: true }); },
  };
  window.Fluxo = ctx;

  /* ====================================================== carregamento */
  async function refresh({ timeline = false } = {}) {
    const id = ++state.requestId;
    try {
      const jobs = [
        state.source.heatmap(state.floor, state.date, state.hour),
        state.source.summary(state.date, state.hour),
        state.source.dwell(state.date, null),
      ];
      if (timeline || !state.timeline.length) jobs.push(state.source.timeline(state.date, null));
      const [heat, summary, dwell, tl] = await Promise.all(jobs);
      if (id !== state.requestId) return;
      state.heat = heat;
      state.dwell = dwell;
      if (tl) state.timeline = tl;
      animateHeat(Object.fromEntries(heat.zones.map((z) => [z.code, heatValue(z)])));
      renderMarkers();
      renderCounts();
      renderSummary(summary);
      renderTimeline();
      renderRoutes();
      if (state.selected) renderCard();
      if (state.view === "journeys") renderJourneys();
      if (state.view === "metrics") renderMetrics();
      moduleView(state.view)?.refresh?.();
      const t = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
      $("#sidebarTime").textContent = t;
      $("#syncDetail").textContent = state.mode === "api" ? `sincronizado ${t}` : "dados simulados";
    } catch (err) { handleError(err); }
  }

  function setHour(h) {
    state.hour = h;
    renderTimeline();
    refresh();
  }

  async function setFloor(floor, { keepSelection = false } = {}) {
    if (floor === state.floor) return;
    state.floor = floor;
    document.querySelectorAll(".floor-switch button").forEach((b) => {
      const on = b.dataset.floor === floor; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on));
    });
    if (!keepSelection) { state.selected = null; el.card.classList.add("closed"); }
    state.heatValues = {};
    el.plan.src = floorsByCode[floor].plan_image;
    state.zoom = 1; state.panX = 0; state.panY = 0; applyTransform();
    fitMap();
    el.routes.replaceChildren();
    await refresh();
  }

  function handleError(err) {
    console.error(err);
    if (err.status === 401 && state.mode === "api") {
      store.del("fluxo.token");
      toast("Sessão expirada — entre novamente");
      showLogin();
      return;
    }
    toast(`Falha ao carregar dados: ${err.message}`);
  }

  /* ========================================================= play / ao vivo */
  function stopPlay() {
    if (!state.playing) return;
    clearInterval(state.playing); state.playing = null;
    $("#playButton use").setAttribute("href", "#i-play");
    $("#playButton").setAttribute("aria-label", "Reproduzir o dia");
  }

  function togglePlay() {
    if (state.playing) return stopPlay();
    $("#playButton use").setAttribute("href", "#i-pause");
    $("#playButton").setAttribute("aria-label", "Pausar");
    let h = state.hour === null || state.hour >= CLOSE_HOUR ? OPEN_HOUR : state.hour + 1;
    setHour(h);
    state.playing = setInterval(() => {
      h += 1;
      if (h > CLOSE_HOUR) { stopPlay(); return; }
      setHour(h);
    }, 1300);
    return undefined;
  }

  /* ============================================================== login */
  function showLogin() {
    stopPlay();
    if (state.view !== "map") setView("map");
    clearInterval(state.pollTimer);
    el.login.classList.remove("done");
    el.app.setAttribute("aria-hidden", "true");
    setTimeout(() => el.loginEmail.focus(), 50);
  }

  async function startApp(source, mode, user) {
    state.source = source; state.mode = mode;
    el.login.classList.add("done");
    el.app.setAttribute("aria-hidden", "false");
    const sync = $("#syncState");
    sync.classList.toggle("demo", mode === "demo");
    $("#syncLabel").textContent = mode === "api" ? "API CONECTADA" : "MODO DEMONSTRAÇÃO";
    $("#healthText").textContent = mode === "api" ? `API ${source.base}` : "Simulador local (sem API)";
    const initials = (user?.name || "Demo").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
    $("#avatarButton").textContent = initials;
    $("#avatarButton").title = `${user?.name || "Modo demonstração"} · clique para sair`;
    $("#dateInput").value = state.date;
    const now = mallNow();
    state.hour = now.date === state.date && now.hour >= OPEN_HOUR && now.hour <= CLOSE_HOUR ? now.hour : null;
    el.plan.src = floorsByCode[state.floor].plan_image;
    fitMap();
    state.timeline = [];
    await refresh({ timeline: true });
    clearInterval(state.pollTimer);
    if (mode === "api") {
      state.pollTimer = setInterval(() => { if (state.date === mallNow().date && !state.playing) refresh({ timeline: true }); }, 60000);
    }
  }

  async function bootstrap() {
    const params = new URLSearchParams(location.search);
    const candidates = [];
    if (params.get("api")) candidates.push(params.get("api"));
    if (location.protocol.startsWith("http")) candidates.push(location.origin);
    candidates.push("http://localhost:8000");
    let api = null; let health = null;
    for (const base of [...new Set(candidates)]) {
      health = await ApiClient.probe(base);
      if (health) { api = new ApiClient(base); break; }
    }
    el.loginForm.dataset.api = api ? "on" : "off";
    if (!api) {
      el.loginApi.textContent = "API não encontrada (rode o backend em localhost:8000) — use o modo demonstração.";
      if (params.get("demo") === "1") startApp(new DemoBackend(), "demo", null);
      return;
    }
    if (health.server_time) state.date = health.server_time.slice(0, 10);
    el.loginApi.textContent = `API conectada · ${api.base} · ${fmt(health.events)} eventos`;
    el.loginForm._api = api;
    const token = store.get("fluxo.token");
    if (token) {
      api.token = token;
      try { const user = await api.me(); startApp(api, "api", user); return; } catch { api.token = null; store.del("fluxo.token"); }
    }
    if (params.get("demo") === "1") startApp(new DemoBackend(), "demo", null);
  }

  el.loginForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    el.loginError.hidden = true;
    const api = el.loginForm._api;
    if (!api) {
      el.loginError.textContent = "API indisponível. Entre em modo demonstração ou inicie o backend.";
      el.loginError.hidden = false;
      return;
    }
    el.loginSubmit.disabled = true;
    try {
      const res = await api.login(el.loginEmail.value.trim(), el.loginPassword.value);
      api.token = res.access_token;
      store.set("fluxo.token", res.access_token);
      el.loginPassword.value = "";
      await startApp(api, "api", res.user);
    } catch (err) {
      el.loginError.textContent = err.status === 401 ? "E-mail ou senha incorretos." : `Não foi possível entrar: ${err.message}`;
      el.loginError.hidden = false;
    } finally { el.loginSubmit.disabled = false; }
  });

  el.demoButton.addEventListener("click", () => {
    state.date = mallNow().date;
    startApp(new DemoBackend(), "demo", null);
  });

  $("#avatarButton").addEventListener("click", () => {
    store.del("fluxo.token");
    if (state.source instanceof ApiClient) state.source.token = null;
    showLogin();
  });

  /* ========================================================== interações */
  document.querySelectorAll(".floor-switch button").forEach((b) => b.addEventListener("click", () => setFloor(b.dataset.floor)));

  $("#dateInput").addEventListener("change", (ev) => {
    if (!ev.target.value) return;
    stopPlay();
    state.date = ev.target.value;
    state.timeline = [];
    refresh({ timeline: true });
  });

  document.querySelectorAll("[data-layer]").forEach((input) => input.addEventListener("change", () => {
    state.layers[input.dataset.layer] = input.checked;
    applyLayers();
  }));

  $("#toggleAll").addEventListener("click", (ev) => {
    const inputs = [...document.querySelectorAll("[data-layer]")];
    const show = inputs.some((i) => !i.checked);
    inputs.forEach((i) => { i.checked = show; state.layers[i.dataset.layer] = show; });
    applyLayers();
    ev.currentTarget.textContent = show ? "Ocultar todas" : "Mostrar todas";
  });

  document.querySelectorAll(".filter-chip").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
    b.classList.add("active");
    state.filter = b.dataset.filter;
    applyFilter();
  }));

  $("#zoomIn").addEventListener("click", () => setZoom(state.zoom + 0.2));
  $("#zoomOut").addEventListener("click", () => setZoom(state.zoom - 0.2));
  $("#recenter").addEventListener("click", () => { state.zoom = 1; state.panX = 0; state.panY = 0; applyTransform(); toast("Planta centralizada"); });

  el.stage.addEventListener("wheel", (ev) => {
    if (!el.panel.hidden) return;
    ev.preventDefault();
    setZoom(state.zoom + (ev.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });

  let drag = null;
  el.stage.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest("button, input, select, .incident-card, .analysis-panel")) return;
    drag = { x: ev.clientX - state.panX, y: ev.clientY - state.panY, moved: false };
    el.stage.classList.add("dragging");
    el.stage.setPointerCapture(ev.pointerId);
  });
  el.stage.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    state.panX = ev.clientX - drag.x; state.panY = ev.clientY - drag.y; drag.moved = true;
    applyTransform();
  });
  const endDrag = (ev) => {
    if (!drag) return;
    drag = null;
    el.stage.classList.remove("dragging");
    if (el.stage.hasPointerCapture(ev.pointerId)) el.stage.releasePointerCapture(ev.pointerId);
  };
  el.stage.addEventListener("pointerup", endDrag);
  el.stage.addEventListener("pointercancel", endDrag);

  $("#closeZone").addEventListener("click", () => {
    state.selected = null;
    el.card.classList.add("closed");
    document.querySelectorAll(".map-marker.active").forEach((m) => m.classList.remove("active"));
    renderRoutes();
  });

  $("#zoneJourneyButton").addEventListener("click", () => {
    if (!state.selected) return;
    $("#pathTarget").value = state.selected;
    setView("journeys");
  });

  $("#playButton").addEventListener("click", togglePlay);
  $("#wholeDay").addEventListener("click", () => { stopPlay(); setHour(null); });

  $(".notification-button").addEventListener("click", () => {
    const hot = (state.heat?.zones || []).filter((z) => z.level === "hot");
    toast(hot.length ? `Hotspots no ${floorShort[state.floor]}: ${hot.map((z) => z.name).join(", ")}` : `Nenhum hotspot no ${floorShort[state.floor]} neste período`);
  });

  document.querySelectorAll(".nav-item").forEach((n) => n.addEventListener("click", (ev) => { ev.preventDefault(); setView(n.dataset.view); }));
  $("#mobileMenu").addEventListener("click", () => el.sidebar.classList.toggle("open"));

  // selects do painel de jornada
  $("#pathTarget").innerHTML = MALL.zones.filter((z) => !z.is_entrance)
    .map((z) => `<option value="${z.code}"${z.code === "T-CINEMARK" ? " selected" : ""}>${esc(z.name)} · ${floorShort[z.floor]}</option>`).join("");
  $("#sectorSelect").innerHTML = MALL.sectors.filter((s) => !["circulacao", "acesso"].includes(s.code))
    .map((s) => `<option value="${s.code}"${s.code === "vestuario" ? " selected" : ""}>${esc(s.name)}</option>`).join("");
  $("#pathTarget").addEventListener("change", renderJourneys);
  $("#sectorSelect").addEventListener("change", renderJourneys);
  $("#zoneRanking tbody").addEventListener("click", (ev) => {
    const row = ev.target.closest("tr[data-code]");
    if (!row) return;
    setView("map");
    selectZone(row.dataset.code, { focus: true });
  });

  // busca
  el.search.addEventListener("input", () => {
    const q = el.search.value.trim().toLocaleLowerCase("pt-BR");
    if (!q) { el.searchResults.hidden = true; return; }
    const levels = Object.fromEntries((state.heat?.zones || []).map((z) => [z.code, z.level]));
    const results = MALL.zones.filter((z) => `${z.name} ${z.store_ref || ""} ${z.code} ${sectorsByCode[z.sector].name}`.toLocaleLowerCase("pt-BR").includes(q)).slice(0, 6);
    if (!results.length) {
      el.searchResults.innerHTML = '<div class="search-result"><span><b>Nenhum resultado</b><small>Tente o nome da loja, setor ou nº (ex.: LOJA 214)</small></span></div>';
    } else {
      el.searchResults.replaceChildren(...results.map((z) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `search-result ${levels[z.code] || ""}`;
        b.innerHTML = `<i></i><span><b>${esc(z.name)}</b><small>${esc(z.store_ref || "")} · ${floorShort[z.floor]}</small></span>`;
        b.addEventListener("click", () => {
          el.search.value = z.name; el.searchResults.hidden = true;
          setView("map");
          selectZone(z.code, { focus: true });
        });
        return b;
      }));
    }
    el.searchResults.hidden = false;
  });

  document.addEventListener("click", (ev) => { if (!ev.target.closest(".search-wrap")) el.searchResults.hidden = true; });

  document.addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); el.search.focus(); return; }
    if (ev.key === "Escape") { el.searchResults.hidden = true; el.sidebar.classList.remove("open"); if (state.view !== "map") setView("map"); return; }
    if (ev.target.closest("input, select, textarea") || !el.login.classList.contains("done")) return;
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      stopPlay();
      const dir = ev.key === "ArrowRight" ? 1 : -1;
      const h = state.hour === null ? (dir > 0 ? OPEN_HOUR : CLOSE_HOUR) : state.hour + dir;
      setHour(h < OPEN_HOUR || h > CLOSE_HOUR ? null : h);
    }
  });

  new ResizeObserver(() => fitMap()).observe(el.stage);

  bootstrap();
})();
