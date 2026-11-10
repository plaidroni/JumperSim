import type { SimJumper, SimPlane } from "../classes/SimEntities";
import {
  defaultFreefallPattern,
  getDropzonePlan,
  getPlanVersion,
  type FreefallPattern,
} from "./DropzonePlan";
import { clampToPolygon, FT, type XZ } from "./geometry";
import {
  flyCanopyPattern,
  jumprunFrameOf,
  laneForOrder,
  laneOfPattern,
  meanWind,
  resolveFreefallPattern,
  type FlownPattern,
  type JumprunFrame,
  type ResolvedFreefallPattern,
} from "./patternMath";
import { resolveLandingZones, resolveZones, type ResolvedLZ, type ResolvedZone } from "../physics/Hazards";
import { normalizeBodyPosition } from "../physics/BodyPositions";
import { allJumpers, flockPlanFor } from "../physics/FormationFlight";
import type { WindLevel } from "../wind/WindProfile";

/**
 * Everything the sim derives from the dropzone plan for one recalculation: resolved
 * zones, the canopy pattern as flown in today's wind, freefall patterns in world space,
 * lanes and aim points. Shared by all jumpers and cached until the plan, jumprun or
 * wind changes.
 */
export interface PlanContext {
  zones: ResolvedZone[];
  lzs: ResolvedLZ[];
  primary: ResolvedLZ | null;
  landingWind: XZ | null;
  flown: FlownPattern | null;
  frame: JumprunFrame;
  /** Freefall pattern (and lane) this jumper flies, or null. */
  routeFor(j: SimJumper): { route: ResolvedFreefallPattern; lane: number } | null;
  /** This jumper's aim point in the primary LZ, or null without one. */
  aimFor(j: SimJumper): XZ | null;
  /** The flown canopy pattern shifted onto an aim point. */
  patternAt(aim: XZ): FlownPattern | null;
}

let cacheKey = "";
let cached: PlanContext | null = null;

export function patternForJumper(j: SimJumper): FreefallPattern | null {
  const pos = normalizeBodyPosition(j.flyingStyle);
  if (pos !== "tracking" && pos !== "wingsuit") return null;
  const plan = getDropzonePlan();
  const id = (j as any).freefallPatternId as string | undefined;
  if (id === "none") return null;
  if (id) {
    const p = plan.freefallPatterns.find((f) => f.id === id && f.kind === pos);
    if (p) return p;
  }
  return defaultFreefallPattern(pos, plan);
}

export function getPlanContext(plane: SimPlane, wind: WindLevel[]): PlanContext {
  const key = [
    getPlanVersion(),
    plane.position.toArray().map((v) => v.toFixed(2)),
    plane.direction.toArray().map((v) => v.toFixed(4)),
    wind.map((l) => [l.heightM.toFixed(0), l.vector.x.toFixed(2), l.vector.z.toFixed(2)]),
  ].join("|");
  if (cached && key === cacheKey) return cached;

  const plan = getDropzonePlan();
  const zones = resolveZones(plan);
  const lzs = resolveLandingZones(plan);
  const primary = lzs.find((r) => r.main) ?? null;
  const landingWind = wind.length ? meanWind(wind, 0, 250 * FT) : null;
  const flown = plan.canopyPattern ? flyCanopyPattern(plan.canopyPattern, landingWind) : null;
  const frame = jumprunFrameOf(plane);
  const resolved = new Map<string, ResolvedFreefallPattern>();
  for (const p of plan.freefallPatterns) if (p.legs.length) resolved.set(p.id, resolveFreefallPattern(p, frame));

  const lanes = new Map<SimJumper, number>();
  const computeLanes = () => {
    if (lanes.size) return;
    const groups = new Map<string, SimJumper[]>();
    for (const j of allJumpers(plane)) {
      const p = patternForJumper(j);
      if (!p) continue;
      const flock = flockPlanFor(j, plane);
      if (flock && flock.slotIndex > 0) continue; // followers fly the base's slot, not a lane
      const list = groups.get(p.id) ?? [];
      list.push(j);
      groups.set(p.id, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.jumpTime - b.jumpTime || a.index - b.index);
      const taken = new Set<number>();
      list.forEach((j) => {
        const o = Number((j as any).laneIndex);
        if (Number.isInteger(o)) {
          lanes.set(j, o);
          taken.add(o);
        }
      });
      let k = 0;
      for (const j of list) {
        if (lanes.has(j)) continue;
        let lane = laneForOrder(k++);
        while (taken.has(lane)) lane = laneForOrder(k++);
        taken.add(lane);
        lanes.set(j, lane);
      }
    }
  };

  // aim points: a golden-angle spiral around the touchdown the user picked, kept inside
  // its landing zone. No landing pattern → no aim point (nothing is assumed).
  const aimFor = (j: SimJumper): XZ | null => {
    if (!flown || !plan.canopyPattern) return null;
    const T = flown.points[3];
    const k = Math.max(0, j.index);
    const spread = Math.max(0, plan.canopyPattern.spreadM ?? 30);
    const r = spread * Math.sqrt(((k % 16) + 0.5) / 16);
    const a = k * 2.39996;
    const p = { x: T.x + Math.cos(a) * r, z: T.z + Math.sin(a) * r };
    return primary ? clampToPolygon(primary.pts, p) : p;
  };

  cacheKey = key;
  cached = {
    zones,
    lzs,
    primary,
    landingWind,
    flown,
    frame,
    routeFor(j) {
      const p = patternForJumper(j);
      const r = p && resolved.get(p.id);
      if (!p || !r) return null;
      computeLanes();
      const lane = lanes.get(j) ?? 0;
      return { route: laneOfPattern(r, lane * (p.laneSpacingM ?? 150)), lane };
    },
    aimFor,
    patternAt(aim) {
      if (!flown) return null;
      const dx = aim.x - flown.points[3].x;
      const dz = aim.z - flown.points[3].z;
      return {
        ...flown,
        points: flown.points.map((p) => ({ x: p.x + dx, z: p.z + dz })) as FlownPattern["points"],
      };
    },
  };
  return cached;
}

/** Forget cached lanes (call before a recalculation when jumpers changed). */
export function invalidatePlanContext() {
  cacheKey = "";
  cached = null;
}
