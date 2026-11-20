import * as THREE from "three";
import { onRecalculated } from "../core/data/SimulationVariables";
import { MS_TO_KT, vectorToFromDeg } from "../wind/WindProfile";
import { CLOUD_TYPE_LABEL, coverLabel } from "../weather/CloudLayers";
import { jumpConditions } from "../weather/Conditions";
import { intensityWord } from "../weather/Precipitation";
import { weatherCodeInfo } from "../weather/WeatherCodes";
import { WeatherDisplaySettings, weatherDisplay } from "../weather/WeatherDisplay";
import { weatherService } from "../weather/WeatherService";
import {
  CloudBand,
  M_PER_STATUTE_MILE,
  M_TO_FT,
  WeatherState,
  cToF,
  formatDzTime,
} from "../weather/WeatherState";

/**
 * Weather tab (specs/weather-clouds-visibility.md §6): status, now, what the 3D view
 * shows, winds aloft (WindWidget), clouds, precipitation, visibility, jump conditions
 * and the next hours. Sections collapse from their header; the state is remembered.
 * Everything redraws when the weather changes, not per frame.
 */

const COLLAPSE_KEY = "jumpersim.weatherPanel.collapsed";
const MM_TO_IN = 1 / 25.4;
const HPA_TO_INHG = 0.0295300;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fin = (v: number) => Number.isFinite(v);
const ftNum = (m: number) => (Math.round((m * M_TO_FT) / 100) * 100).toLocaleString();
const ftLabel = (m: number) => `${ftNum(m)} ft`;
/** "4,200–6,100 ft" */
const ftRange = (a: number, b: number) => `${ftNum(a)}–${ftNum(b)} ft`;
const sm = (m: number) => {
  const v = m / M_PER_STATUTE_MILE;
  return !fin(v) ? "–" : v < 10 ? v.toFixed(1) : String(Math.round(v));
};
const km = (m: number) => (fin(m) ? (m / 1000).toFixed(m < 10000 ? 1 : 0) : "–");
/** Whole knots, truncated like the winds-aloft widget. */
const kt = (ms: number) => (fin(ms) ? Math.trunc(ms * MS_TO_KT) : NaN);
const pad3 = (deg: number) => String(Math.round(deg) % 360).padStart(3, "0");

export function initializeWeatherPanel() {
  const tab = document.getElementById("weatherdata-panel");
  if (!tab || tab.querySelector(".wx-status")) return;

  // ------------------------------------------------------------------ status
  const status = document.createElement("div");
  status.className = "wx-status";
  status.innerHTML = `
    <div class="wx-status-row">
      <span class="wx-dot" aria-hidden="true"></span>
      <span class="wx-state" role="status"></span>
      <span class="wx-valid"></span>
      <span class="wx-ago"></span>
      <span class="wx-spacer"></span>
      <button type="button" class="wx-btn wx-refresh" title="Refresh weather now">⟳</button>
      <label class="wx-hold" title="Stop automatic weather updates">
        <input type="checkbox" class="wx-hold-box" /> Hold
      </label>
    </div>
    <div class="wx-override" hidden>
      Dev override: <strong class="wx-override-name"></strong>
      <button type="button" class="wx-btn wx-override-clear" title="Back to the real weather">Clear</button>
    </div>
    <div class="wx-source">
      <a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a>
      <span class="wx-error"></span>
    </div>`;

  // ------------------------------------------------------------------ sections
  const sections = document.createElement("div");
  sections.className = "wx-sections";
  const collapsed = readCollapsed();
  const sec = (id: string, title: string) => {
    const el = document.createElement("section");
    el.className = "wx-sec";
    el.dataset.sec = id;
    el.innerHTML = `
      <button type="button" class="wx-sec-head" aria-expanded="true">
        <span class="wx-caret" aria-hidden="true">▾</span><span class="wx-sec-title">${title}</span>
        <span class="wx-sec-sum"></span>
      </button>
      <div class="wx-sec-body"></div>`;
    const head = el.querySelector(".wx-sec-head") as HTMLButtonElement;
    const setCollapsed = (c: boolean) => {
      el.classList.toggle("collapsed", c);
      head.setAttribute("aria-expanded", String(!c));
    };
    setCollapsed(collapsed.has(id));
    head.addEventListener("click", () => {
      const c = !el.classList.contains("collapsed");
      setCollapsed(c);
      c ? collapsed.add(id) : collapsed.delete(id);
      saveCollapsed(collapsed);
    });
    sections.appendChild(el);
    return {
      el,
      body: el.querySelector(".wx-sec-body") as HTMLElement,
      sum: el.querySelector(".wx-sec-sum") as HTMLElement,
    };
  };

  const now = sec("now", "Now");
  const show = sec("show", "Show in 3D");
  const windSlot = document.createElement("div");
  windSlot.className = "wx-wind-slot";
  sections.appendChild(windSlot);
  const clouds = sec("clouds", "Clouds");
  const precip = sec("precip", "Precipitation");
  const vis = sec("vis", "Visibility");
  const cond = sec("cond", "Jump conditions");
  const hours = sec("hours", "Next hours");

  // the wind widget (WindWidget.ts) was mounted first; move it between the sections
  const wind = tab.querySelector(".wind-widget");
  if (wind) windSlot.appendChild(wind);
  tab.insertBefore(sections, tab.firstChild);
  tab.insertBefore(status, sections);

  // ------------------------------------------------------------------ status logic
  const q = <T extends HTMLElement>(sel: string) => status.querySelector(sel) as T;
  const holdBox = q<HTMLInputElement>(".wx-hold-box");
  q<HTMLButtonElement>(".wx-refresh").addEventListener("click", () => weatherService.refresh("manual"));
  holdBox.addEventListener("change", () => weatherService.setHold(holdBox.checked));
  q<HTMLButtonElement>(".wx-override-clear").addEventListener("click", () => weatherService.setOverride(null));

  function renderStatus() {
    const s = weatherService.status();
    status.dataset.state = s.kind;
    holdBox.checked = weatherService.held;
    const stateEl = q<HTMLElement>(".wx-state");
    const validEl = q<HTMLElement>(".wx-valid");
    const agoEl = q<HTMLElement>(".wx-ago");
    const errEl = q<HTMLElement>(".wx-error");
    const ov = q<HTMLElement>(".wx-override");
    const ovName = weatherService.overrideName;
    ov.hidden = !ovName;
    q<HTMLElement>(".wx-override-name").textContent = ovName ?? "";
    errEl.textContent = "";
    if (s.kind === "idle" || s.kind === "loading") {
      stateEl.textContent = "Loading weather…";
      validEl.textContent = agoEl.textContent = "";
      return;
    }
    if (s.kind === "error") {
      stateEl.textContent = "Weather unavailable";
      validEl.textContent = agoEl.textContent = "";
      errEl.textContent = s.error;
      return;
    }
    const st = s.state;
    stateEl.textContent = s.kind === "live" ? "Live" : s.kind === "stale" ? "Stale" : "Hold";
    validEl.textContent = `Valid ${formatDzTime(st.validTime, st.timezone)}`;
    validEl.title =
      `${st.dz.name} local time (${st.timezone})\n` +
      `${new Date(st.validTime).toLocaleString()} your time\n` +
      `${new Date(st.validTime).toISOString().slice(0, 16).replace("T", " ")} UTC`;
    agoEl.textContent = `· updated ${ago(st.fetchedAt)}`;
    if (s.error) errEl.textContent = `Last update failed: ${s.error}`;
  }

  // ------------------------------------------------------------------ show in 3D
  show.body.innerHTML = `
    <div class="wx-chips">
      <label><input type="checkbox" data-set="clouds" /> Clouds</label>
      <label><input type="checkbox" data-set="cloudShadows" /> Shadows</label>
      <label><input type="checkbox" data-set="precipitation" /> Rain</label>
      <label><input type="checkbox" data-set="darken" /> Darken</label>
      <label><input type="checkbox" data-set="haze" /> Haze</label>
    </div>
    <div class="wx-chips wx-chips-more">
      <label><input type="checkbox" data-set="visibilityRing" /> Visibility ring</label>
      <label><input type="checkbox" data-set="plannerClouds" /> Clouds in planner</label>
      <label class="wx-quality">Quality
        <select data-set="quality">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
    </div>
    <div class="wx-note">The 3D cloud, rain and haze effects arrive in a later update; these settings are saved for them.</div>`;
  show.body.querySelectorAll<HTMLInputElement>("input[data-set]").forEach((box) =>
    box.addEventListener("change", () => weatherDisplay.set({ [box.dataset.set!]: box.checked } as any)),
  );
  const qualitySel = show.body.querySelector("select[data-set=quality]") as HTMLSelectElement;
  qualitySel.addEventListener("change", () => weatherDisplay.set({ quality: qualitySel.value as any }));

  function renderShow(d: WeatherDisplaySettings) {
    show.body.querySelectorAll<HTMLInputElement>("input[data-set]").forEach((box) => {
      box.checked = (d as any)[box.dataset.set!] === true;
    });
    qualitySel.value = d.quality;
    const on = (["clouds", "precipitation", "haze"] as const).filter((k) => d[k]).length;
    show.sum.textContent = `${on}/3 on`;
    clouds.body.querySelectorAll<HTMLInputElement>("input[data-layer]").forEach((box) => {
      box.checked = d.layers[box.dataset.layer as CloudBand];
      box.disabled = !d.clouds;
    });
  }

  // ------------------------------------------------------------------ weather sections
  function renderWeather() {
    const st = weatherService.get();
    const empty = (el: { body: HTMLElement; sum: HTMLElement }, text: string) => {
      el.sum.textContent = "";
      el.body.innerHTML = `<div class="wx-empty">${text}</div>`;
    };
    if (!st) {
      const msg = weatherService.status().kind === "error" ? "Weather unavailable." : "Loading weather…";
      [now, clouds, precip, vis, cond, hours].forEach((s) => empty(s, msg));
      return;
    }
    renderNow(st);
    renderClouds(st);
    renderPrecip(st);
    renderVis(st);
    renderConditions(st);
    renderHours(st);
    renderShow(weatherDisplay.get());
  }

  function renderNow(st: WeatherState) {
    const s = st.surface;
    const w = weatherCodeInfo(s.weatherCode, s.isDay);
    const gust = kt(s.gustMs) > kt(s.windMs) ? ` G${kt(s.gustMs)}` : "";
    const wind = fin(s.windMs)
      ? kt(s.windMs) < 1
        ? "Calm"
        : `${pad3(s.windFromDeg)}° ${kt(s.windMs)} kt${gust}`
      : "–";
    now.sum.textContent = `${w.icon} ${fin(s.tempC) ? Math.round(cToF(s.tempC)) + " °F" : ""}`;
    now.body.innerHTML = `
      <div class="wx-now-main"><span class="wx-icon">${w.icon}</span><span>${esc(w.text)}</span>
        <span class="wx-muted">${s.isDay ? "Day" : "Night"}</span></div>
      <dl class="wx-grid">
        <dt>Temperature</dt><dd title="${fin(s.tempC) ? s.tempC.toFixed(1) + " °C" : ""}">${fin(s.tempC) ? Math.round(cToF(s.tempC)) + " °F" : "–"}</dd>
        <dt>Dew point</dt><dd title="${fin(s.dewPointC) ? s.dewPointC.toFixed(1) + " °C" : ""}">${fin(s.dewPointC) ? Math.round(cToF(s.dewPointC)) + " °F" : "–"}</dd>
        <dt>Surface wind</dt><dd title="10 m wind, gusts over the last hour">${wind}</dd>
        <dt>QNH</dt><dd>${fin(s.pressureMslHpa) ? `${Math.round(s.pressureMslHpa)} hPa · ${(s.pressureMslHpa * HPA_TO_INHG).toFixed(2)} inHg` : "–"}</dd>
      </dl>`;
  }

  function renderClouds(st: WeatherState) {
    const c = st.clouds;
    const d = weatherDisplay.get();
    const ceiling = c.ceilingAglM === null ? "no ceiling" : `ceiling ${ftLabel(c.ceilingAglM)} AGL`;
    clouds.sum.textContent = `${fin(c.totalPct) ? Math.round(c.totalPct) : "–"}% · ${ceiling}`;
    const rows = c.layers
      .slice()
      .reverse()
      .map((l) => {
        const v = new THREE.Vector3(l.drift.x, 0, l.drift.z);
        const driftKt = Math.round(v.length() * MS_TO_KT);
        const drift = driftKt < 1 ? "still" : `from ${pad3(vectorToFromDeg(v))}° at ${driftKt} kt`;
        const t = CLOUD_TYPE_LABEL[l.type];
        const msl = `${ftRange(l.baseAglM + st.elevationM, l.topAglM + st.elevationM)} MSL`;
        return `
          <div class="wx-layer">
            <label class="wx-layer-show" title="Show this layer in 3D">
              <input type="checkbox" data-layer="${l.band}" ${d.layers[l.band] ? "checked" : ""} ${d.clouds ? "" : "disabled"} />
              <span class="wx-band">${l.band}</span>
            </label>
            <span class="wx-type" title="${t.name}${l.precipitating ? ", raining" : ""}">${t.abbr} ${t.name}${l.precipitating ? " 🌧" : ""}</span>
            <span class="wx-heights" title="${msl}">${ftRange(l.baseAglM, l.topAglM)}</span>
            <span class="wx-cover"><span class="wx-bar"><span style="width:${Math.min(100, l.coverPct)}%"></span></span>
              ${Math.round(l.coverPct)}% ${coverLabel(l.coverPct)}</span>
            <span class="wx-drift">${drift}</span>
          </div>`;
      })
      .join("");
    const s = st.surface;
    const extra: string[] = [];
    if (fin(s.freezingLevelMslM)) extra.push(`Freezing level ${ftLabel(s.freezingLevelMslM)} MSL`);
    if (s.capeJkg >= 100) extra.push(`CAPE ${Math.round(s.capeJkg)} J/kg · lifted index ${fin(s.liftedIndex) ? s.liftedIndex.toFixed(1) : "–"}`);
    clouds.body.innerHTML = `
      <div class="wx-cloud-sum">Total ${fin(c.totalPct) ? Math.round(c.totalPct) : "–"}% · ${ceiling}
        <span class="wx-muted">(low ${pct(c.lowPct)} · mid ${pct(c.midPct)} · high ${pct(c.highPct)})</span></div>
      ${rows ? `<div class="wx-layers">${rows}</div>` : `<div class="wx-empty">No cloud layers.</div>`}
      ${extra.length ? `<div class="wx-muted">${extra.join(" · ")}</div>` : ""}
      <div class="wx-note">Heights AGL (hover for MSL). Cloud positions are illustrative; amounts and heights are forecast.</div>`;
    clouds.body.querySelectorAll<HTMLInputElement>("input[data-layer]").forEach((box) =>
      box.addEventListener("change", () =>
        weatherDisplay.set({ layers: { [box.dataset.layer as CloudBand]: box.checked } }),
      ),
    );
  }

  function renderPrecip(st: WeatherState) {
    const p = st.precip;
    const word = intensityWord(p.kind, p.mmPerH, p.snowCmPerH);
    const head = p.kind === "none" ? "None" : `${cap(word)} ${p.kind}`;
    const rate =
      p.kind === "snow" && p.snowCmPerH > 0
        ? `${p.snowCmPerH.toFixed(1)} cm/h snow`
        : fin(p.mmPerH)
          ? `${p.mmPerH.toFixed(1)} mm/h · ${(p.mmPerH * MM_TO_IN).toFixed(2)} in/h`
          : "–";
    precip.sum.textContent = p.kind === "none" ? `${pct(p.probabilityPct)} chance` : head;
    const t = st.trend15;
    const max = Math.max(1, ...t.precipMmPerH.filter(fin));
    const bars = t.time
      .map((time, i) => {
        const v = t.precipMmPerH[i];
        const h = fin(v) ? Math.max(v > 0 ? 6 : 0, (v / max) * 100) : 0;
        const isNow = time === st.validTime;
        return `<span class="wx-pbar${isNow ? " now" : ""}${time < st.validTime ? " past" : ""}"
          title="${formatDzTime(time, st.timezone)}: ${fin(v) ? v.toFixed(1) : "–"} mm/h"><span style="height:${h}%"></span></span>`;
      })
      .join("");
    precip.body.innerHTML = `
      <dl class="wx-grid">
        <dt>Now</dt><dd>${esc(head)}${p.kind === "none" ? "" : ` · ${rate}`}</dd>
        <dt>Chance</dt><dd title="Chance of more than 0.1 mm in the hour">${pct(p.probabilityPct)}</dd>
      </dl>
      ${t.time.length ? `<div class="wx-pbars" aria-label="Precipitation every 15 minutes">${bars}</div>
        <div class="wx-axis"><span>${formatDzTime(t.time[0], st.timezone)}</span><span>now</span><span>${formatDzTime(t.time[t.time.length - 1], st.timezone)}</span></div>` : ""}`;
  }

  function renderVis(st: WeatherState) {
    const v = st.visibilityM;
    const vSm = v / M_PER_STATUTE_MILE;
    const cls = !fin(vSm) ? "" : vSm < 3 ? "bad" : vSm < 5 ? "warn" : "good";
    vis.sum.textContent = `${sm(v)} sm`;
    const width = fin(vSm) ? Math.min(100, (vSm / 10) * 100) : 0;
    const t = st.trend15;
    vis.body.innerHTML = `
      <div class="wx-vis-main"><strong>${sm(v)} sm</strong> <span class="wx-muted">${km(v)} km · surface visibility</span></div>
      <div class="wx-visbar ${cls}" title="0–10 sm; marks at 3 and 5 sm">
        <span class="fill" style="width:${width}%"></span>
        <span class="mark" style="left:30%"><i>3</i></span><span class="mark" style="left:50%"><i>5</i></span>
      </div>
      ${t.time.length ? sparkline(t.time, t.visibilityM.map((m) => m / M_PER_STATUTE_MILE), st) : ""}`;
  }

  function renderConditions(st: WeatherState) {
    const plane = (window as any).simPlane;
    const exitAglM = Number(plane?.initialPosition?.y);
    const isUS = (window as any).selectedDropzone?.country === "United States";
    if (!fin(exitAglM)) {
      cond.sum.textContent = "";
      cond.body.innerHTML = `<div class="wx-empty">No exit altitude yet.</div>`;
      return;
    }
    const r = jumpConditions(st, exitAglM, isUS);
    const worst = r.items.some((i) => i.status === "fail") ? "fail" : r.items.some((i) => i.status === "warn") ? "warn" : r.rule === "faa" ? "ok" : "info";
    cond.sum.textContent = { ok: "✓ within minimums", warn: "⚠ check", fail: "✗ below minimums", info: "values only" }[worst];
    cond.sum.dataset.status = worst;
    const icon = { ok: "✓", warn: "⚠", fail: "✗", info: "ℹ" };
    cond.body.innerHTML = `
      <div class="wx-muted">Exit ${ftLabel(exitAglM)} AGL (${ftLabel(exitAglM + st.elevationM)} MSL)${r.rule === "faa" ? " · 14 CFR 105.17" : ""}</div>
      <ul class="wx-cond">${r.items.map((i) => `<li class="${i.status}"><span>${icon[i.status]}</span>${esc(i.text)}</li>`).join("")}</ul>
      <div class="wx-note">Informational, not a go/no-go. Uses surface visibility for flight visibility and the illustrative cloud layers.</div>`;
  }

  function renderHours(st: WeatherState) {
    const h = st.trendHourly;
    const idx = h.time.map((_, i) => i).filter((i) => h.time[i] + 3600_000 > st.validTime).slice(0, 12);
    if (!idx.length) {
      hours.sum.textContent = "";
      hours.body.innerHTML = `<div class="wx-empty">No hourly forecast.</div>`;
      return;
    }
    const hourFmt = (t: number) => {
      try {
        return new Intl.DateTimeFormat(undefined, { timeZone: st.timezone, hour: "numeric" }).format(t);
      } catch {
        return new Date(t).getUTCHours() + "Z";
      }
    };
    const maxProb = Math.max(...idx.map((i) => h.precipProbabilityPct[i]).filter(fin), 0);
    hours.sum.textContent = maxProb > 0 ? `rain chance up to ${Math.round(maxProb)}%` : "";
    const row = (label: string, title: string, cell: (i: number) => string) =>
      `<tr><th title="${title}">${label}</th>${idx.map((i) => `<td>${cell(i)}</td>`).join("")}</tr>`;
    hours.body.innerHTML = `
      <div class="wx-hours"><table>
        ${row("", "", (i) => hourFmt(h.time[i]))}
        ${row("", "", (i) => weatherCodeInfo(h.weatherCode[i], true).icon)}
        ${row("Low", "Low cloud cover %", (i) => pct(h.lowPct[i], ""))}
        ${row("Mid", "Mid cloud cover %", (i) => pct(h.midPct[i], ""))}
        ${row("High", "High cloud cover %", (i) => pct(h.highPct[i], ""))}
        ${row("Rain", "Chance of precipitation %", (i) => pct(h.precipProbabilityPct[i], ""))}
        ${row("Vis", "Visibility (sm)", (i) => sm(h.visibilityM[i]))}
      </table></div>`;
  }

  // ------------------------------------------------------------------ wiring
  const isShown = () => tab.offsetParent !== null && !tab.hidden;
  weatherService.onChange(() => {
    renderStatus();
    renderWeather();
  });
  weatherDisplay.onChange(renderShow);
  onRecalculated(() => {
    const st = weatherService.get();
    if (st) renderConditions(st); // the exit altitude may have changed
  });
  window.addEventListener("tab-shown", (e: any) => {
    if (e.detail?.tab === "weatherdata") renderStatus();
  });
  window.setInterval(() => {
    if (isShown()) renderStatus();
  }, 30_000);
  renderStatus();
  renderWeather();
  renderShow(weatherDisplay.get());
}

// ---------------------------------------------------------------------- helpers

function pct(v: number, unit = "%"): string {
  return fin(v) ? `${Math.round(v)}${unit}` : "–";
}

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function ago(t: number): string {
  const min = Math.floor((Date.now() - t) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min ago`;
}

/** Visibility over time (sm, capped at 10), with dashed 3 and 5 sm lines. */
function sparkline(times: number[], valuesSm: number[], st: WeatherState): string {
  const W = 240;
  const H = 34;
  const n = times.length;
  const y = (v: number) => H - 2 - (Math.min(10, Math.max(0, v)) / 10) * (H - 4);
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2);
  const pts = valuesSm.map((v, i) => (fin(v) ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : "")).filter(Boolean).join(" ");
  const nowI = times.indexOf(st.validTime);
  return `
    <svg class="wx-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
      aria-label="Visibility every 15 minutes from ${formatDzTime(times[0], st.timezone)}">
      <line x1="0" x2="${W}" y1="${y(3)}" y2="${y(3)}" class="lim3" />
      <line x1="0" x2="${W}" y1="${y(5)}" y2="${y(5)}" class="lim5" />
      ${nowI >= 0 ? `<line x1="${x(nowI)}" x2="${x(nowI)}" y1="0" y2="${H}" class="now" />` : ""}
      <polyline points="${pts}" />
    </svg>`;
}

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    const arr = raw ? JSON.parse(raw) : ["hours"];
    return new Set(Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : []);
  } catch {
    return new Set(["hours"]);
  }
}

function saveCollapsed(set: Set<string>) {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
  } catch {
    /* storage blocked */
  }
}
