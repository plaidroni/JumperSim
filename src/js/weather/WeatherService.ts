import { handleForeignRecalculation, signalWeatherReady } from "../Scripts";
import { notificationManager } from "../classes/NotificationManager";
import { DropzoneRef, fetchWeather } from "./OpenMeteoClient";
import { WeatherState, formatDzTime, toLegacySnapshot } from "./WeatherState";
import { maxWindChangeMs } from "../wind/WindProfile";
import { WEATHER_PRESETS, WeatherOverride, applyOverride, resolveOverride } from "./Overrides";

/**
 * Weather store and refresh schedule (specs/weather-clouds-visibility.md §4.2).
 *
 * - "Now" is Open-Meteo's current 15-minute step; it is refetched just after each
 *   new step starts while the app is visible, and on demand.
 * - Hold stops the automatic refreshes.
 * - The winds the physics uses only change when they move by ≥ 1 kt somewhere, and
 *   never in the middle of playback or a planner drag; everything else updates at once.
 */

const STEP_MS = 15 * 60 * 1000;
const AFTER_STEP_MS = 90 * 1000;
const JITTER_MS = 30 * 1000;
const STALE_AFTER_MS = 30 * 60 * 1000;
const BACKOFF_MIN = [1, 2, 5, 10, 15];
/** A wind level moving by at least this much (m/s, ≈ 1 kt) triggers a recalculation. */
export const WIND_CHANGE_RECALC_MS = 0.5;

export type WeatherStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "live" | "stale" | "hold"; state: WeatherState; error?: string }
  | { kind: "error"; error: string };

type Listener = () => void;

class WeatherService {
  private dz: DropzoneRef | null = null;
  private dzKey = "";
  private requestId = 0;
  private abort: AbortController | null = null;
  private timer: number | null = null;
  private pendingTimer: number | null = null;

  /** Latest weather as fetched. */
  private base: WeatherState | null = null;
  /** Latest weather as shown (sky, panel): `base` with any dev override applied. */
  private latest: WeatherState | null = null;
  private override: { name: string; values: WeatherOverride } | null = null;
  /** The state whose winds the physics was computed with. */
  private windState: WeatherState | null = null;
  /** Newer winds waiting for playback / a planner drag to finish. */
  private pendingWinds: WeatherState | null = null;

  private hold = false;
  /** A saved weather state from a .jsim file is being flown; fetches don't replace it. */
  private pinned: string | null = null;
  private loading = false;
  private failures = 0;
  private lastError = "";
  private readySignalled = false;
  private listeners = new Set<Listener>();

  constructor() {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && this.isDue()) this.refresh("auto");
      });
      window.addEventListener("online", () => this.refresh("auto"));
    }
  }

  // ---------------------------------------------------------------- public API

  get(): WeatherState | null {
    return this.latest;
  }

  /** The weather whose winds are in use by the physics (may lag `get()`). */
  getWindState(): WeatherState | null {
    return this.windState;
  }

  get held() {
    return this.hold;
  }

  status(): WeatherStatus {
    if (!this.latest) {
      if (this.loading || (this.dz && !this.lastError)) return { kind: "loading" };
      return this.lastError ? { kind: "error", error: this.lastError } : { kind: "idle" };
    }
    const error = this.lastError || undefined;
    if (this.hold) return { kind: "hold", state: this.latest, error };
    const stale = Date.now() - this.latest.fetchedAt > STALE_AFTER_MS;
    return { kind: stale ? "stale" : "live", state: this.latest, error };
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Select a dropzone: drop the old weather and fetch for this one. */
  setDropzone(dz: DropzoneRef) {
    if (!dz || !Number.isFinite(dz.latitude) || !Number.isFinite(dz.longitude)) return;
    this.dz = dz;
    this.dzKey = `${dz.name}|${dz.latitude},${dz.longitude}`;
    this.pendingWinds = null;
    this.failures = 0;
    this.lastError = "";
    this.refresh("dz");
  }

  /** Fetch now. `manual` is the ⟳ button (it works while held, and confirms with a toast). */
  async refresh(reason: "dz" | "auto" | "manual" = "manual") {
    if (!this.dz) return;
    if (reason === "auto" && this.hold) return;
    this.clearTimer();
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const id = ++this.requestId;
    const dzKey = this.dzKey;
    const dz = this.dz;
    this.loading = true;
    this.emit();

    try {
      const state = await fetchWeather(dz, abort.signal);
      if (id !== this.requestId || dzKey !== this.dzKey) return; // superseded
      const recovered = this.failures > 0;
      this.failures = 0;
      this.lastError = "";
      this.loading = false;
      if (this.pinned) return; // flying the weather from a file
      this.apply(state, reason === "dz");
      if (reason === "dz") {
        notificationManager.success(
          `Weather for ${dz.name}: valid ${formatDzTime(state.validTime, state.timezone)}`,
          { duration: 4000 },
        );
      } else if (reason === "manual") {
        notificationManager.success("Weather updated", { duration: 3000 });
      } else if (recovered) {
        notificationManager.info("Weather data is updating again", { duration: 4000 });
      }
    } catch (err) {
      if (id !== this.requestId || dzKey !== this.dzKey) return;
      if ((err as any)?.name === "AbortError") return;
      this.loading = false;
      this.failures++;
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error("Weather fetch failed", err);
      if (this.failures === 1 || reason === "manual") {
        notificationManager.error(
          this.latest ? "Weather update failed. Showing the last data." : "Weather data unavailable",
          {
            duration: 8000,
            actions: [{ label: "Retry", callback: () => this.refresh("manual"), primary: true }],
          },
        );
      }
      this.emit();
    } finally {
      if (id === this.requestId) {
        if (!this.readySignalled) {
          // the sim waits for the first answer, good or bad
          this.readySignalled = true;
          signalWeatherReady();
        }
        this.schedule();
      }
    }
  }

  /**
   * Fly a saved weather state (from a .jsim file) and hold it: fetches no longer
   * replace it until `unpin()` (specs/formation-jumps.md §12.5).
   */
  pin(state: WeatherState, label: string, overrideName: string | null = null) {
    this.pinned = label;
    this.hold = true;
    this.clearTimer();
    this.abort?.abort();
    this.loading = false;
    if (overrideName) {
      try {
        this.override = resolveOverride(overrideName);
      } catch {
        this.override = null;
      }
    } else this.override = null;
    this.pendingWinds = null;
    this.base = state;
    this.latest = this.withOverride(state);
    if (!this.readySignalled) {
      this.readySignalled = true;
      signalWeatherReady();
    }
    this.useWinds(state, true);
  }

  /** Stop flying the file's weather and fetch live weather again. */
  unpin() {
    if (!this.pinned) return;
    this.pinned = null;
    this.hold = false;
    this.refresh("dz");
  }

  /** Label of the file whose weather is pinned, or null. */
  get pinnedLabel(): string | null {
    return this.pinned;
  }

  /** The state the physics uses, for saving. */
  exportState(): WeatherState | null {
    return this.windState ?? this.base;
  }

  setHold(hold: boolean) {
    if (hold === this.hold) return;
    if (!hold && this.pinned) {
      this.unpin();
      return;
    }
    this.hold = hold;
    if (hold) this.clearTimer();
    else if (this.isDue()) this.refresh("auto");
    else this.schedule();
    this.emit();
  }

  // ---------------------------------------------------------------- internals

  /**
   * Dev override on top of the fetched weather (a preset name or values), or null to
   * clear it. Winds are never overridden.
   */
  setOverride(input: string | WeatherOverride | null) {
    this.override = input === null ? null : resolveOverride(input);
    this.latest = this.base ? this.withOverride(this.base) : null;
    if (this.latest) this.publish(false);
    else this.emit();
  }

  get overrideName(): string | null {
    return this.override?.name ?? null;
  }

  private withOverride(state: WeatherState): WeatherState {
    return this.override ? applyOverride(state, this.override.values, this.override.name) : state;
  }

  private apply(state: WeatherState, newDz: boolean) {
    this.base = state;
    this.latest = this.withOverride(state);
    const windsChanged =
      newDz || !this.windState || maxWindChangeMs(this.windState, state) >= WIND_CHANGE_RECALC_MS;
    if (!windsChanged) {
      this.pendingWinds = null;
      this.publish(false);
      return;
    }
    if (newDz || !this.windState) {
      this.pendingWinds = null;
      // before the first answer the sim is still waiting for weather; after it
      // (another DZ, or a retry after a failed first fetch) it has to rerun
      this.useWinds(state, this.readySignalled);
      return;
    }
    this.pendingWinds = state;
    this.publish(false);
    this.applyPendingWinds();
  }

  /** Swap in waiting winds once playback is paused and no planner drag is in progress. */
  private applyPendingWinds() {
    if (this.pendingTimer !== null) window.clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    if (!this.pendingWinds) return;
    const w = window as any;
    if (w.isPlaying || w.planner?.interacting) {
      this.pendingTimer = window.setTimeout(() => this.applyPendingWinds(), 1000);
      return;
    }
    const state = this.pendingWinds;
    this.pendingWinds = null;
    this.useWinds(state, true);
  }

  private useWinds(state: WeatherState, recalculate: boolean) {
    this.windState = state;
    (window as any).weatherSnapshotLog = [toLegacySnapshot(state)];
    this.publish(recalculate);
  }

  private publish(recalculate: boolean) {
    // the wind tower, wind widget and planner redraw on this event
    window.dispatchEvent(new CustomEvent("weather-updated"));
    if (recalculate) handleForeignRecalculation();
    this.emit();
  }

  private emit() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error("weather listener failed", err);
      }
    });
  }

  /** Data is from an older 15-minute step than the current one. */
  private isDue() {
    if (!this.dz) return false;
    if (!this.latest) return true;
    return Date.now() >= this.latest.validTime + STEP_MS + AFTER_STEP_MS;
  }

  private schedule() {
    this.clearTimer();
    if (!this.dz || this.hold) return;
    let delay: number;
    if (this.failures > 0) {
      delay = BACKOFF_MIN[Math.min(this.failures, BACKOFF_MIN.length) - 1] * 60_000;
    } else {
      const base = this.latest ? this.latest.validTime + STEP_MS + AFTER_STEP_MS : Date.now();
      delay = base + (Math.random() * 2 - 1) * JITTER_MS - Date.now();
      delay = Math.max(60_000, delay);
    }
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (typeof document !== "undefined" && document.hidden) return; // visibilitychange catches up
      this.refresh("auto");
    }, delay);
  }

  private clearTimer() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}

export const weatherService = new WeatherService();
(window as any).weatherService = weatherService;

/** Dev overrides from the console (specs/weather-clouds-visibility.md §7). */
(window as any).weatherDebug = {
  override: (input: string | WeatherOverride) => weatherService.setOverride(input),
  clear: () => weatherService.setOverride(null),
  presets: Object.keys(WEATHER_PRESETS),
};

// dev builds: ?weather=<preset>
if (import.meta.env?.DEV && typeof location !== "undefined") {
  const preset = new URLSearchParams(location.search).get("weather");
  if (preset) {
    try {
      weatherService.setOverride(preset);
    } catch (err) {
      console.warn(String(err));
    }
  }
}
