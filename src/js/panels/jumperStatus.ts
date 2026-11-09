import type { SimJumper, SimPlane } from "../classes/SimEntities";
import { BODY_POSITIONS, normalizeBodyPosition } from "../physics/BodyPositions";
import { phaseAt } from "../physics/Canopy";
import { PHASE_LABEL, type CanopyPhase } from "../physics/CanopyGuidance";

/** Shared jumper telemetry for Plane Settings and Scene Objects. */

export const M_TO_FT = 3.28084;
export const MS_TO_MPH = 2.236936;

export function simTime(): number {
  const w = window as any;
  if (typeof w.simulationTime === "number") return w.simulationTime;
  if (typeof w.currentTime === "number") return w.currentTime;
  return 0;
}

/** Exited = more than 2 m from the plane (falls back to the scheduled jump time). */
export function hasJumperExited(j: SimJumper, plane: SimPlane, t = simTime()): boolean {
  const js = j.track.getInterpolatedSample(t);
  const ps = plane.track.getInterpolatedSample(t);
  if (!js || !ps) return t >= j.jumpTime;
  return js.position.distanceTo(ps.position) > 2;
}

export function jumperStatus(j: SimJumper, plane: SimPlane, t = simTime()): string {
  if (j.landTime !== null && t >= j.landTime) {
    const o = j.landingOutcome;
    if (!o) return "Landed";
    if (o.kind === "hazard") return `⚠ Landed in ${o.name}`;
    if (o.kind === "lz") return `Landed · ${o.name}`;
    return "Landed out";
  }
  if (!hasJumperExited(j, plane, t)) return "In plane";
  if (j.formationStatus && j.formationEndTime !== null && t < j.formationEndTime) {
    return j.roundSlot ? `${j.formationStatus} · Slot ${j.roundSlot}` : j.formationStatus;
  }
  const flockOn = j.flockSlotLabel !== null && (j.flockBreakoffTime === null || t < j.flockBreakoffTime);
  if (flockOn && j.flockSlotLabel !== "Base") {
    if (j.flockDockedTime === null || t < j.flockDockedTime) return `Closing on base · ${j.flockSlotLabel}`;
    return `Wingsuit flock · ${j.flockSlotLabel}`;
  }
  const { phase } = phaseAt(j.deployment, t);
  if (phase === "pilot-chute") return "Pilot chute out";
  if (phase === "bag") return "Bag out";
  if (phase === "canopy") {
    if (j.deployment && t < j.deployment.openTime) return "Canopy inflating";
    const hz = j.hazardEvents.find((e) => t >= e.start && t <= e.end + 0.1);
    if (hz) return `⚠ Over ${hz.name} below its ceiling`;
    let nav: CanopyPhase | null = null;
    for (const p of j.canopyPhases) if (p.t <= t) nav = p.phase;
    if (nav) {
      if (nav === "straight-in" && j.canopyAlternate) return `Going for ${j.canopyAlternate}`;
      return PHASE_LABEL[nav];
    }
    const wl = j.canopyPerf?.wingLoading;
    return wl ? `Under canopy · WL ${wl.toFixed(2)}` : "Under canopy";
  }
  if (j.breakoffHoldTime !== null && t >= j.breakoffHoldTime) return `Holding slot ${j.roundSlot ?? ""}`.trim();
  const position = normalizeBodyPosition(j.flyingStyle);
  const route = j.freefallRoute;
  if (route && route.legTimes.length && t >= route.legTimes[0]) {
    let leg = 0;
    route.legTimes.forEach((lt, i) => {
      if (t >= lt) leg = i;
    });
    const name = position === "wingsuit" ? (flockOn ? "Wingsuit flock · Base" : "Wingsuit") : "Tracking jump";
    const lane = route.lane ? ` · Lane ${route.lane > 0 ? "+" : ""}${route.lane}` : "";
    return `${name} · Leg ${leg + 1}/${route.legCount}${lane}`;
  }
  if (position === "wingsuit") return flockOn ? "Wingsuit flock · Base" : "Wingsuit flight";
  if (position === "tracking") return j.trackStartTime !== null && t >= j.trackStartTime ? "Tracking jump" : "Freefall · Exit";
  if (j.trackStartTime !== null && t >= j.trackStartTime) return j.roundSlot ? `Tracking to slot ${j.roundSlot}` : "Tracking";
  return `Freefall · ${BODY_POSITIONS[position].label}`;
}

export function jumperName(j: SimJumper): string {
  return (j as any).name ? String((j as any).name) : `Jumper ${j.index + 1}`;
}

/** Heading (deg, clockwise from north) of a world-space horizontal vector. */
export function headingDeg(x: number, z: number): number {
  // world: +X = east, -Z = north
  return (Math.round((Math.atan2(x, -z) * 180) / Math.PI) + 360) % 360;
}
