// Jump Settings tab: exit altitude and plane speed (specs/formation-jumps.md §7.1).

import {
  EXIT_ALT_MAX_FT,
  EXIT_ALT_MIN_FT,
  getJumpSettings,
  onJumpSettingsChanged,
  setJumpSettings,
} from "../core/data/JumpSettings";
import { onRecalculated } from "../core/data/SimulationVariables";
import { weatherService } from "../weather/WeatherService";
import { DEFAULT_ROUND_SETTINGS } from "../physics/FormationShapes";
import { DEFAULT_PULL_FT } from "../physics/Canopy";

const M_TO_FT = 3.28084;
const fmt = (ft: number) => `${Math.round(ft).toLocaleString()} ft`;

export function initializeJumpSettingsPanel() {
  const alt = document.getElementById("exitAltitude") as HTMLInputElement | null;
  const speed = document.getElementById("planeSpeed") as HTMLInputElement | null;
  const name = document.getElementById("jumpname") as HTMLInputElement | null;
  const msl = document.getElementById("exitAltitude-msl");
  const hint = document.getElementById("jump-settings-hint");
  const warn = document.getElementById("jump-settings-warn");

  const sync = () => {
    const s = getJumpSettings();
    if (alt && document.activeElement !== alt) alt.value = String(s.exitAltitudeFt);
    if (speed && document.activeElement !== speed) speed.value = String(s.planeSpeedKt);
    if (name && document.activeElement !== name) name.value = s.name;
    renderHints();
  };

  const flash = (el: HTMLElement) => {
    el.classList.remove("js-flash");
    void el.offsetWidth;
    el.classList.add("js-flash");
  };

  alt?.addEventListener("change", () => {
    const v = Number(alt.value);
    if (!Number.isFinite(v)) return sync();
    if (v < EXIT_ALT_MIN_FT || v > EXIT_ALT_MAX_FT) flash(alt);
    setJumpSettings({ exitAltitudeFt: v });
    sync();
  });
  speed?.addEventListener("change", () => {
    const v = Number(speed.value);
    if (!Number.isFinite(v)) return sync();
    setJumpSettings({ planeSpeedKt: v });
    sync();
  });
  name?.addEventListener("input", () => setJumpSettings({ name: name.value }, { recalc: false }));

  function renderHints() {
    const s = getJumpSettings();
    const elevM = weatherService.get()?.elevationM;
    const elevFt = Number.isFinite(elevM) ? (elevM as number) * M_TO_FT : null;
    if (msl) msl.textContent = elevFt !== null ? `${fmt(s.exitAltitudeFt + elevFt)} MSL` : "";

    const w = window as any;
    const plane = w.simPlane;
    const breakoffFt = Number(plane?.roundSettings?.breakoffFt) || DEFAULT_ROUND_SETTINGS.breakoffFt;
    // freefall time to breakoff at belly fall rate (≈ 10 s to terminal, then ~120 mph)
    const dropFt = s.exitAltitudeFt - breakoffFt;
    const secs = dropFt > 0 ? Math.max(0, (dropFt * 0.3048 - 300) / 53.6 + 10) : 0;
    if (hint) hint.textContent = dropFt > 0 ? `Breakoff ${fmt(breakoffFt)} · ≈ ${Math.round(secs)} s to breakoff` : "";

    const warnings: string[] = [];
    const formations = (w.fleet?.formations ?? plane?.formations ?? []) as any[];
    if (formations.length && s.exitAltitudeFt < breakoffFt + 1000)
      warnings.push(`No time to build: exit ${fmt(s.exitAltitudeFt)}, breakoff ${fmt(breakoffFt)}`);
    const jumpers = (Array.isArray(w.simJumpers) ? w.simJumpers : []) as any[];
    const lowPull = jumpers.filter((j) => (j.pullAltitudeFt ?? DEFAULT_PULL_FT) + 1000 > s.exitAltitudeFt);
    if (lowPull.length)
      warnings.push(`Exit is less than 1,000 ft above the pull for ${lowPull.length} jumper${lowPull.length > 1 ? "s" : ""}`);
    if (elevFt !== null && s.exitAltitudeFt + elevFt > 15000)
      warnings.push("Above 15,000 ft MSL: oxygen required (14 CFR 91.211)");
    if (warn) {
      warn.textContent = warnings.map((x) => `⚠ ${x}`).join("\n");
      warn.hidden = warnings.length === 0;
    }
  }

  onJumpSettingsChanged(sync);
  onRecalculated(renderHints);
  weatherService.onChange(() => renderHints());
  sync();
}
