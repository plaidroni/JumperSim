// Recalculation of the simulation after something changes (weather, jumprun, plane
// load, ...). This used to show a "Simulation Variables Changed" prompt; now the sim
// simply recalculates on its own. Requests in the same tick are merged into one run.

type RecalcHandler = () => void;

let handler: RecalcHandler | null = null;
let scheduled = false;
const listeners = new Set<() => void>();

/** Scripts.ts registers the function that re-runs the physics and redraws the scene. */
export function setRecalculationHandler(fn: RecalcHandler) {
  handler = fn;
}

/** Be told after every recalculation (e.g. so a panel can show fresh results). */
export function onRecalculated(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Recalculate the simulation (merged with any other request in the same tick). */
export function requestRecalculation(fallback?: () => void) {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    if (handler) handler();
    else fallback?.();
    listeners.forEach((fn) => fn());
  });
}

/**
 * Kept for existing callers: no longer asks, just recalculates.
 * @deprecated use requestRecalculation()
 */
export function askForRefresh(
  onRecalculate?: () => void,
  _autoRecalculate: boolean = true,
  _source?: string,
) {
  requestRecalculation(onRecalculate);
}
