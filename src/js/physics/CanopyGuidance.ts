import * as THREE from "three";
import type { CanopyPerformance } from "./Canopy";
import type { FlownPattern } from "../dropzone/patternMath";
import type { XZ } from "../dropzone/geometry";
import { clampToPolygon, FT, polygonCentroid } from "../dropzone/geometry";
import { hazardAt, maxCeilingM, type ResolvedLZ, type ResolvedZone } from "./Hazards";
import { crabHeading, headingToward, rotateHeading } from "./Steering";
import { getGroundHeight } from "../terrain/GroundHeight";

/**
 * Canopy navigation: hold above the pattern, fly downwind → base → final (turning by
 * altitude, cutting corners when low), fall back to a straight-in to an alternate LZ or
 * a land-out when the pattern can't be reached, and steer around danger zones that are
 * above the jumper.
 */

export type CanopyPhase =
  | "holding"
  | "downwind"
  | "base"
  | "final"
  | "straight-in"
  | "landing-out";

export const PHASE_LABEL: Record<CanopyPhase, string> = {
  holding: "Holding",
  downwind: "Downwind",
  base: "Base",
  final: "Final",
  "straight-in": "Straight-in",
  "landing-out": "Landing out",
};

const HOLD_UPWIND_M = 100;
const HOLD_RADIUS_M = 150;
const HOLD_ABOVE_M = 100 * FT;
const LOOKAHEAD_AIM_M = 60;
const CUT_CORNER_M = 75 * FT;
const S_TURN_DEG = 70;
const FINAL_MARGIN_M = 5;
const S_TURN_PERIOD_S = 8;
const AVOID_LOOKAHEAD_S = 8;
const AVOID_STEPS_DEG = [15, 30, 45, 60, 75, 90];

export interface CanopyGuidanceInput {
  perf: CanopyPerformance;
  /** Pattern being flown, shifted onto this jumper's aim point (null = no plan pattern). */
  pattern: FlownPattern | null;
  /** This jumper's aim point in the primary LZ (or the DZ origin with no plan). */
  aim: XZ;
  /** Landing heading for straight-ins (into the surface wind, or along jumprun when calm). */
  landingHeading: THREE.Vector3;
  zones: ResolvedZone[];
  lzs: ResolvedLZ[];
  /** wind (m/s) at a height in m above the DZ. */
  windAt: (y: number) => THREE.Vector3;
}

export class CanopyGuidance {
  phase: CanopyPhase = "holding";
  /** LZ being flown to when not the primary pattern (alternate), else null. */
  alternate: ResolvedLZ | null = null;
  private target: XZ;
  private planned = false;
  private readonly maxCeiling: number;

  constructor(private readonly i: CanopyGuidanceInput) {
    this.target = { ...i.aim };
    this.maxCeiling = maxCeilingM(i.zones);
  }

  /** Decide, once at full open, whether the pattern is reachable. */
  private plan(pos: THREE.Vector3) {
    this.planned = true;
    const { perf, pattern } = this.i;
    const h = pos.y - getGroundHeight(this.target.x, this.target.z);
    if (!pattern) {
      this.phase = "straight-in";
      return;
    }
    const reach = (to: XZ, arriveM: number, margin = 0) => {
      const dx = to.x - pos.x;
      const dz = to.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1) return h >= arriveM;
      const wind = this.i.windAt(pos.y);
      const heading = crabHeading(new THREE.Vector3(dx, 0, dz), perf.horizontalMs, wind);
      const gs = Math.max(0.3, heading.x * perf.horizontalMs * (dx / d) + heading.z * perf.horizontalMs * (dz / d) + (wind.x * dx + wind.z * dz) / d);
      return h - (d / gs) * perf.verticalMs >= arriveM + margin;
    };
    if (reach(pattern.points[0], pattern.altsM[0] - 50 * FT)) {
      this.phase = h > pattern.altsM[0] + HOLD_ABOVE_M ? "holding" : "downwind";
      return;
    }
    // can't make the pattern: straight-in to the target if that still works
    if (reach(this.target, 0, 50 * FT)) {
      this.phase = "straight-in";
      return;
    }
    // alternates, nearest first (straight-in into the wind)
    // aim for the nearest part of each alternate LZ (20 m in from its edge), not its centre
    const spotIn = (r: ResolvedLZ): XZ => {
      const edge = clampToPolygon(r.pts, { x: pos.x, z: pos.z });
      const c = polygonCentroid(r.pts);
      const d = Math.hypot(c.x - edge.x, c.z - edge.z) || 1;
      const k = Math.min(20, d) / d;
      return { x: edge.x + (c.x - edge.x) * k, z: edge.z + (c.z - edge.z) * k };
    };
    const others = this.i.lzs
      .filter((r) => !r.main)
      .map((r) => ({ r, spot: spotIn(r) }))
      .sort((a, b) => Math.hypot(a.spot.x - pos.x, a.spot.z - pos.z) - Math.hypot(b.spot.x - pos.x, b.spot.z - pos.z));
    for (const { r, spot } of others) {
      if (reach(spot, 0, 50 * FT)) {
        this.alternate = r;
        this.target = spot;
        this.phase = "straight-in";
        return;
      }
    }
    this.phase = "landing-out";
  }

  /** Desired air heading this step. */
  desired(pos: THREE.Vector3, wind: THREE.Vector3, t: number): THREE.Vector3 {
    if (!this.planned) this.plan(pos);
    const d = this.patternHeading(pos, wind, t);
    return this.avoid(pos, d);
  }

  private straightIn(pos: THREE.Vector3, wind: THREE.Vector3): THREE.Vector3 {
    const { perf, landingHeading } = this.i;
    const h = Math.max(0, pos.y - getGroundHeight(this.target.x, this.target.z));
    const finalGround = Math.max(0.5, perf.horizontalMs + wind.x * landingHeading.x + wind.z * landingHeading.z);
    const R = (h / perf.verticalMs) * finalGround;
    const aim = { x: this.target.x - landingHeading.x * R, z: this.target.z - landingHeading.z * R };
    const dist = Math.hypot(aim.x - pos.x, aim.z - pos.z);
    if (dist < 25 + 0.1 * R) return landingHeading.clone();
    return headingToward(pos, aim, perf.horizontalMs, wind);
  }

  private patternHeading(pos: THREE.Vector3, wind: THREE.Vector3, t: number): THREE.Vector3 {
    const { perf } = this.i;
    const p = this.i.pattern;
    if (!p || this.phase === "straight-in" || this.phase === "landing-out") return this.straightIn(pos, wind);

    const [P0, P1, P2, T] = p.points;
    const [A0, A1, A2] = p.altsM;
    const h = pos.y - getGroundHeight(T.x, T.z);

    if (this.phase === "holding") {
      if (h > A0 + HOLD_ABOVE_M) {
        const ws = Math.hypot(wind.x, wind.z);
        const intoWind =
          ws > 0.5
            ? new THREE.Vector3(-wind.x / ws, 0, -wind.z / ws)
            : new THREE.Vector3(T.x - P2.x, 0, T.z - P2.z).normalize();
        const H = { x: P0.x + intoWind.x * HOLD_UPWIND_M, z: P0.z + intoWind.z * HOLD_UPWIND_M };
        if (Math.hypot(H.x - pos.x, H.z - pos.z) > HOLD_RADIUS_M) return headingToward(pos, H, perf.horizontalMs, wind);
        const side = Math.floor(t / S_TURN_PERIOD_S) % 2 === 0 ? 1 : -1;
        return rotateHeading(intoWind, side * S_TURN_DEG);
      }
      this.phase = "downwind";
    }
    if (this.phase === "downwind" && h <= A1) this.phase = "base";
    if (this.phase === "base" && h <= A2) this.phase = "final";

    if (this.phase === "final") return headingToward(pos, T, perf.horizontalMs, wind);

    // running out of height for the rest of the pattern: turn for the target now
    if (h < this.heightNeeded(pos, T, wind) + FINAL_MARGIN_M) {
      this.phase = "final";
      return headingToward(pos, T, perf.horizontalMs, wind);
    }

    const [a, b, next, gate] = this.phase === "downwind" ? [P0, P1, P2, A1] : [P1, P2, T, A2];
    const lx = b.x - a.x;
    const lz = b.z - a.z;
    const len = Math.hypot(lx, lz) || 1;
    const ux = lx / len;
    const uz = lz / len;
    const along = (pos.x - a.x) * ux + (pos.z - a.z) * uz;

    // low? cut the corner and head for the point after the turn
    const remaining = len - along;
    if (remaining > 0) {
      const gsAlong = Math.max(0.3, perf.horizontalMs + wind.x * ux + wind.z * uz);
      const predicted = h - (remaining / gsAlong) * perf.verticalMs;
      if (predicted < gate - CUT_CORNER_M) return headingToward(pos, next, perf.horizontalMs, wind);
    }
    // track the leg line (beyond its end too: being high stretches the leg)
    const aimAlong = Math.max(0, along) + LOOKAHEAD_AIM_M;
    const aim = { x: a.x + ux * aimAlong, z: a.z + uz * aimAlong };
    return headingToward(pos, aim, perf.horizontalMs, wind);
  }

  /** Height (m) needed to glide straight to `to` from `pos` in this wind. */
  private heightNeeded(pos: THREE.Vector3, to: XZ, wind: THREE.Vector3): number {
    const { perf } = this.i;
    const dx = to.x - pos.x;
    const dz = to.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1) return 0;
    const hd = crabHeading(new THREE.Vector3(dx, 0, dz), perf.horizontalMs, wind);
    const gs = (hd.x * perf.horizontalMs + wind.x) * (dx / d) + (hd.z * perf.horizontalMs + wind.z) * (dz / d);
    return gs <= 0.3 ? Infinity : (d / gs) * perf.verticalMs;
  }

  /** Keep clear of danger zones that are above the jumper over the next few seconds. */
  private avoid(pos: THREE.Vector3, desired: THREE.Vector3): THREE.Vector3 {
    const zones = this.i.zones;
    if (!zones.length) return desired;
    const { perf } = this.i;
    const agl = pos.y - getGroundHeight(pos.x, pos.z);
    if (agl - perf.verticalMs * AVOID_LOOKAHEAD_S > this.maxCeiling) return desired;
    const clear = (h: THREE.Vector3) => {
      for (let s = 1; s <= AVOID_LOOKAHEAD_S; s++) {
        const y = pos.y - perf.verticalMs * s;
        const w = this.i.windAt(y);
        const x = pos.x + (h.x * perf.horizontalMs + w.x) * s;
        const z = pos.z + (h.z * perf.horizontalMs + w.z) * s;
        const a = y - getGroundHeight(x, z);
        if (a <= 2) break; // on the ground: the landing check handles that
        if (hazardAt(zones, x, z, a)) return false;
      }
      return true;
    };
    if (clear(desired)) return desired;
    for (const deg of AVOID_STEPS_DEG) {
      for (const sgn of [1, -1]) {
        const h = rotateHeading(desired, sgn * deg);
        if (clear(h)) return h;
      }
    }
    return desired;
  }
}
