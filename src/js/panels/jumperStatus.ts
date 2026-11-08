import type { SimJumper, SimPlane } from "../classes/SimEntities";
import { BODY_POSITIONS, normalizeBodyPosition } from "../physics/BodyPositions";

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
  if (j.landTime !== null && t >= j.landTime) return "Landed";
  if (!hasJumperExited(j, plane, t)) return "In plane";
  const position = normalizeBodyPosition(j.flyingStyle);
  if (position === "wingsuit") return "Wingsuit flight";
  if (j.trackStartTime !== null && t >= j.trackStartTime) return "Tracking";
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
