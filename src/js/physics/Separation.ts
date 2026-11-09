import type { SimJumper } from "../classes/SimEntities";
import { jumperName } from "../panels/jumperStatus";

/**
 * Separation at deployment: for every jumper's pull, the horizontal distance to every
 * other airborne jumper within 300 m of height at that moment. Pairs closer than the
 * minimum are reported; nobody changes course because of it.
 */

export interface SeparationWarning {
  a: SimJumper;
  b: SimJumper;
  time: number;
  distanceM: number;
  text: string;
}

let warnings: SeparationWarning[] = [];
const VERTICAL_WINDOW_M = 300;

export function getSeparationWarnings(): SeparationWarning[] {
  return warnings;
}

export function computeSeparation(jumpers: SimJumper[], minSepM: number) {
  warnings = [];
  const seen = new Set<string>();
  for (const a of jumpers) {
    a.pullSeparation = null;
    const t = a.deployment?.pullTime;
    if (t === undefined || t === null) continue;
    const pa = a.track.getInterpolatedSample(t);
    if (!pa) continue;
    let best: { distanceM: number; other: SimJumper } | null = null;
    for (const b of jumpers) {
      if (b === a || b.jumpTime > t || (b.landTime !== null && b.landTime <= t)) continue;
      const pb = b.track.getInterpolatedSample(t);
      if (!pb || Math.abs(pb.position.y - pa.position.y) > VERTICAL_WINDOW_M) continue;
      const d = Math.hypot(pa.position.x - pb.position.x, pa.position.z - pb.position.z);
      if (!best || d < best.distanceM) best = { distanceM: d, other: b };
    }
    if (!best) continue;
    a.pullSeparation = { distanceM: best.distanceM, otherId: best.other.id };
    const key = [a.id, best.other.id].sort().join("|");
    if (best.distanceM < minSepM && !seen.has(key)) {
      seen.add(key);
      warnings.push({
        a,
        b: best.other,
        time: t,
        distanceM: best.distanceM,
        text: `${jumperName(a)} is ${Math.round(best.distanceM)} m from ${jumperName(best.other)} at pull`,
      });
    }
  }
  warnings.sort((x, y) => x.time - y.time);
}
