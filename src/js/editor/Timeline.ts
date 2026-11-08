import { onRecalculated } from "../core/data/SimulationVariables";

/**
 * Timeline bar extras (playback state itself lives in TimeScrubber.ts):
 * keyboard shortcuts, playback speed, and exit / track / landing markers.
 */

const w = window as any;

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable;
}

function setupShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const t = w.currentTime ?? 0;
    switch (e.key) {
      case " ":
      case "Spacebar":
        // a focused button handles Space itself
        if ((e.target as HTMLElement)?.tagName === "BUTTON") return;
        e.preventDefault();
        w.isPlaying ? w.pause?.() : w.play?.();
        break;
      case "ArrowLeft":
        e.preventDefault();
        w.updateScrubber?.(t - (e.shiftKey ? 10 : 1));
        break;
      case "ArrowRight":
        e.preventDefault();
        w.updateScrubber?.(t + (e.shiftKey ? 10 : 1));
        break;
      case "Home":
        e.preventDefault();
        w.updateScrubber?.(0);
        break;
      case "End":
        e.preventDefault();
        w.updateScrubber?.(w.maxTime ?? 0);
        break;
    }
  });
}

function setupSpeed() {
  const sel = document.getElementById("playback-speed") as HTMLSelectElement | null;
  if (!sel) return;
  sel.addEventListener("change", () => {
    const v = parseFloat(sel.value);
    w.playbackSpeed = Number.isFinite(v) && v > 0 ? v : 1;
  });
}

/** Ticks on the scrubber: exits (white), track starts (gold), landings (grey). */
export function renderTimelineMarkers() {
  const box = document.getElementById("timeline-markers");
  if (!box) return;
  box.replaceChildren();
  const max = Number(w.maxTime) || 0;
  const jumpers: any[] = Array.isArray(w.simJumpers) ? w.simJumpers : [];
  if (max <= 0 || jumpers.length === 0) return;

  const add = (t: number | null | undefined, kind: string, label: string) => {
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > max) return;
    const m = document.createElement("div");
    m.className = "timeline-marker";
    m.dataset.kind = kind;
    m.style.left = `${(t / max) * 100}%`;
    m.title = `${label} · ${t.toFixed(1)} s`;
    box.appendChild(m);
  };

  [...jumpers]
    .sort((a, b) => a.index - b.index)
    .forEach((j) => {
      const name = j.name || `Jumper ${j.index + 1}`;
      add(j.jumpTime, "exit", `${name}: exit`);
      add(j.trackStartTime, "track", `${name}: starts tracking`);
      add(j.landTime, "land", `${name}: lands`);
    });
}

let initialized = false;

export function initializeTimeline() {
  if (initialized) return;
  initialized = true;
  setupShortcuts();
  setupSpeed();
  onRecalculated(() => renderTimelineMarkers());
  w.renderTimelineMarkers = renderTimelineMarkers;
}
