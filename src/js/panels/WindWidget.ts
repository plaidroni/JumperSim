import * as THREE from "three";
import {
  STRONG_SHEAR_KT_PER_1000FT,
  WindLevel,
  currentWindProfile,
  windShears,
} from "../wind/WindProfile";

/**
 * Weather tab: "winds aloft" rows for each forecast height, with an arrow showing
 * where the wind blows relative to the camera (up = away from you) and the speed
 * truncated to whole knots. Strong shear between rows gets a red bar.
 */

const M_TO_FT = 3.28084;
const SPEED_STOPS: Array<[number, THREE.Color]> = [
  [0, new THREE.Color(0x6fb7ff)],
  [15, new THREE.Color(0xffd700)],
  [30, new THREE.Color(0xff7a00)],
];

export function initializeWindWidget(camera: THREE.Camera, controls: { addEventListener: Function }) {
  const tab = document.getElementById("weatherdata-panel");
  if (!tab || tab.querySelector(".wind-widget")) return;

  const root = document.createElement("div");
  root.className = "wind-widget";
  root.innerHTML = `
    <div class="wind-widget-head">
      <span><strong>Winds aloft</strong> · camera view</span>
      <span class="wind-time"></span>
    </div>
    <div class="wind-rows" role="table" aria-label="Winds aloft by height"></div>`;
  tab.insertBefore(root, tab.firstChild);
  const rowsEl = root.querySelector(".wind-rows") as HTMLElement;
  const timeEl = root.querySelector(".wind-time") as HTMLElement;

  let levels: WindLevel[] = [];
  let arrows: Array<{ el: SVGElement; toDeg: number }> = [];
  let lastHeading = NaN;
  let queued = false;
  const dir = new THREE.Vector3();

  const isShown = () => tab.offsetParent !== null && !tab.hidden;

  function rebuild() {
    levels = currentWindProfile().slice().sort((a, b) => b.heightM - a.heightM);
    const snapshot = (window as any).weatherSnapshotLog?.[0];
    timeEl.textContent = snapshot?.time ? String(snapshot.time) : "";
    rowsEl.replaceChildren();
    arrows = [];
    lastHeading = NaN;
    if (levels.length === 0) {
      const empty = document.createElement("div");
      empty.className = "wind-empty";
      empty.textContent = "No wind data yet.";
      rowsEl.appendChild(empty);
      return;
    }
    // shear between adjacent levels, keyed by the lower level
    const shearBelow = new Map<WindLevel, number>();
    windShears(levels.slice().reverse()).forEach((s) => {
      if (s.ktPer1000ft >= STRONG_SHEAR_KT_PER_1000FT) shearBelow.set(s.upper, s.ktPer1000ft);
    });

    levels.forEach((level) => {
      const row = document.createElement("div");
      row.className = "wind-row";
      row.setAttribute("role", "row");
      const ft = Math.round((level.heightM * M_TO_FT) / 100) * 100;
      const kt = Math.trunc(level.speedKt);
      const toDeg = (level.fromDeg + 180) % 360;
      row.title = `${ft.toLocaleString()} ft: from ${Math.round(level.fromDeg)}° at ${kt} kt`;

      const h = document.createElement("span");
      h.className = "wind-h";
      h.setAttribute("role", "cell");
      h.textContent = `${ft.toLocaleString()} ft`;

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("class", "wind-arrow");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", `blowing toward ${Math.round(toDeg)}°`);
      svg.innerHTML = `<path d="M12 2 L19 12 H14 V22 H10 V12 H5 Z" fill="#${speedColor(level.speedKt).getHexString()}"/>`;

      const sp = document.createElement("span");
      sp.className = "wind-s";
      sp.setAttribute("role", "cell");
      sp.textContent = `${kt} kt`;

      row.append(h, svg, sp);
      rowsEl.appendChild(row);
      arrows.push({ el: svg, toDeg });

      const shear = shearBelow.get(level);
      if (shear !== undefined) {
        const bar = document.createElement("div");
        bar.className = "wind-shear";
        bar.title = `Strong shear: ${Math.round(shear)} kt/1000 ft`;
        bar.setAttribute("role", "separator");
        bar.setAttribute("aria-label", bar.title);
        rowsEl.appendChild(bar);
      }
    });
    updateArrows(true);
  }

  /** Rotate arrows so "up" is the direction the camera faces. */
  function updateArrows(force = false) {
    if (!isShown() && !force) return;
    camera.getWorldDirection(dir);
    if (Math.hypot(dir.x, dir.z) < 1e-6) return; // looking straight down/up: keep last
    const heading = THREE.MathUtils.radToDeg(Math.atan2(dir.x, -dir.z)); // +X east, -Z north
    if (!force && Math.abs(heading - lastHeading) < 0.5) return;
    lastHeading = heading;
    arrows.forEach((a) => a.el.style.setProperty("transform", `rotate(${a.toDeg - heading}deg)`));
  }

  const queueUpdate = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      updateArrows();
    });
  };

  controls.addEventListener("change", queueUpdate);
  window.addEventListener("weather-updated", rebuild);
  window.addEventListener("tab-shown", (e: any) => {
    if (e.detail?.tab === "weatherdata") updateArrows(true);
  });
  rebuild();
}

function speedColor(kt: number): THREE.Color {
  if (kt <= SPEED_STOPS[0][0]) return SPEED_STOPS[0][1].clone();
  for (let i = 0; i < SPEED_STOPS.length - 1; i++) {
    const [k0, c0] = SPEED_STOPS[i];
    const [k1, c1] = SPEED_STOPS[i + 1];
    if (kt <= k1) return c0.clone().lerp(c1, (kt - k0) / (k1 - k0));
  }
  return SPEED_STOPS[SPEED_STOPS.length - 1][1].clone();
}
