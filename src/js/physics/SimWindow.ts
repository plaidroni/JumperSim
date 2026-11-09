/**
 * How far ahead the physics is precalculated, and how long the timeline runs.
 * Canopy descents take minutes, so the tracks run well past the last exit and the
 * scrubber is then trimmed to just after the last landing.
 */
export const SIM_DURATION_S = 900;

interface TimedJumper {
  jumpTime: number;
  landTime: number | null;
}

/** Fit the timeline to the precalculated jump: last landing plus a short tail. */
export function updateSimWindow(jumpers: TimedJumper[]) {
  if (!jumpers.length) return;
  const anyAirborne = jumpers.some((j) => j.landTime === null);
  const lastLanding = Math.max(...jumpers.map((j) => j.landTime ?? 0));
  const end = anyAirborne ? SIM_DURATION_S : Math.min(SIM_DURATION_S, Math.ceil(lastLanding + 10));
  const w = window as any;
  if (w.playback?.setMaxTime) w.playback.setMaxTime(end);
  else w.maxTime = end;
  if (typeof w.currentTime === "number" && w.currentTime > end) w.updateScrubber?.(end);
}
