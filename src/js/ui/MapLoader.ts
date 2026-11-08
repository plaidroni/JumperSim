// Controls the map loading screen (#map-loader in index.html,
// styles in src/css/map-loader.css): logo + progress bar, fades out when done.

const FADE_MS = 600;

let progress = 0;
let hideTimer: number | null = null;

function els() {
  return {
    root: document.getElementById("map-loader"),
    fill: document.getElementById("map-loader-fill"),
  };
}

/** Show the loading screen with an empty bar. */
export function showMapLoader() {
  const { root } = els();
  if (!root) return;
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  progress = 0;
  renderProgress();
  root.classList.remove("is-gone");
  // force a reflow so the fade-in applies after display: none is removed
  void root.offsetWidth;
  root.classList.remove("is-hidden");
}

/** Set progress (0–1). The bar never moves backwards while a load is running. */
export function setMapLoaderProgress(fraction: number) {
  if (!Number.isFinite(fraction)) return;
  progress = Math.max(progress, Math.min(1, Math.max(0, fraction)));
  renderProgress();
}

/** Fill the bar, then fade the loading screen out. */
export function hideMapLoader() {
  const { root } = els();
  if (!root) return;
  setMapLoaderProgress(1);
  root.classList.add("is-hidden");
  root.setAttribute("aria-busy", "false");
  hideTimer = window.setTimeout(() => {
    root.classList.add("is-gone");
    hideTimer = null;
  }, FADE_MS);
}

function renderProgress() {
  const { root, fill } = els();
  if (fill) fill.style.width = `${Math.round(progress * 100)}%`;
  if (root) {
    root.setAttribute("aria-busy", progress < 1 ? "true" : "false");
    root.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
  }
}
