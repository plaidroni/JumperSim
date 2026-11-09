import * as THREE from "three";
import type { ResolvedFreefallPattern } from "../dropzone/patternMath";
import { FT } from "../dropzone/geometry";
import { crabHeading } from "./Steering";
import { turnToward } from "./Canopy";

/**
 * Freefall pattern following for trackers and wingsuiters: fly each leg (to a point or
 * on a heading) until its end rule (altitude, arrival or time), with wind-corrected
 * steering, a turn-rate limit, and glide modulation so the jumper reaches each point
 * near its gate altitude. Pull altitude always ends the pattern (handled by the sim).
 */

export interface GlideRange {
  min: number;
  max: number;
  default: number;
}

export const GLIDE_RANGES: Record<"tracking" | "wingsuit", GlideRange> = {
  tracking: { min: 0.6, max: 1.0, default: 1.0 },
  wingsuit: { min: 1.8, max: 2.8, default: 2.5 },
};

export const TURN_RATE_DEG_S: Record<"tracking" | "wingsuit", number> = {
  tracking: 45,
  wingsuit: 20,
};

const ARRIVAL_RADIUS_M = 50;
const GLIDE_EASE_TAU_S = 2;
const GATE_TOLERANCE_M = 50 * FT;

export class FreefallGuidance {
  leg = 0;
  legStartTimes: number[] = [];
  glide: number;
  private legStartPos: THREE.Vector3 | null = null;
  done = false;

  constructor(
    readonly route: ResolvedFreefallPattern,
    readonly kind: "tracking" | "wingsuit",
  ) {
    this.glide = GLIDE_RANGES[kind].default;
  }

  get legCount() {
    return this.route.legs.length;
  }

  /**
   * Update `dir` (horizontal unit vector, modified in place) and the glide ratio for
   * this step. `vy` is the current vertical speed (m/s, negative when falling).
   */
  step(t: number, dt: number, pos: THREE.Vector3, vy: number, wind: THREE.Vector3, dir: THREE.Vector3) {
    const legs = this.route.legs;
    if (!legs.length) return;
    if (this.legStartPos === null) {
      this.legStartPos = pos.clone();
      this.legStartTimes.push(t);
    }

    // leg end rules
    while (!this.done) {
      const leg = legs[this.leg];
      const startPos = this.legStartPos!;
      let ended = false;
      if (leg.end.by === "altitude") ended = pos.y <= leg.end.ft * FT;
      else if (leg.end.by === "time") ended = t - this.legStartTimes[this.leg] >= leg.end.s;
      else {
        const lx = leg.point.x - startPos.x;
        const lz = leg.point.z - startPos.z;
        const len = Math.hypot(lx, lz);
        const along = len > 0 ? ((pos.x - startPos.x) * lx + (pos.z - startPos.z) * lz) / len : 0;
        ended = Math.hypot(leg.point.x - pos.x, leg.point.z - pos.z) < ARRIVAL_RADIUS_M || along >= len;
      }
      if (!ended) break;
      if (this.leg >= legs.length - 1) {
        this.done = true; // hold the last heading until pull
        break;
      }
      this.leg++;
      this.legStartPos = pos.clone();
      this.legStartTimes.push(t);
    }

    const fall = Math.max(1, Math.abs(vy));
    const range = GLIDE_RANGES[this.kind];
    const leg = legs[this.leg];
    let desired: THREE.Vector3 | null = null;
    let targetGlide = range.default;

    if (!this.done && leg.steer === "heading" && leg.headingDir) {
      desired = new THREE.Vector3(leg.headingDir.x, 0, leg.headingDir.z);
    } else if (!this.done) {
      const to = new THREE.Vector3(leg.point.x - pos.x, 0, leg.point.z - pos.z);
      const d = to.length();
      if (d > 1) {
        desired = crabHeading(to, this.glide * fall, wind);
        if (leg.end.by === "altitude") {
          // glide needed to cover d by the time the gate altitude is reached
          const timeToGate = (pos.y - leg.end.ft * FT) / fall;
          if (timeToGate <= 0) targetGlide = range.max;
          else {
            const windAlong = (wind.x * to.x + wind.z * to.z) / d;
            const needed = (d / timeToGate - windAlong) / fall;
            // only adjust when clearly early or late at the gate
            const arriveH = pos.y - (d / Math.max(0.3, this.glide * fall + windAlong)) * fall;
            const gateH = leg.end.ft * FT;
            targetGlide =
              Math.abs(arriveH - gateH) > GATE_TOLERANCE_M
                ? THREE.MathUtils.clamp(needed, range.min, range.max)
                : this.glide;
          }
        } else {
          targetGlide = range.default;
        }
      }
    }
    this.glide += (targetGlide - this.glide) * (1 - Math.exp(-dt / GLIDE_EASE_TAU_S));
    if (desired) turnToward(dir, desired, THREE.MathUtils.degToRad(TURN_RATE_DEG_S[this.kind]) * dt);
  }

  status(): string {
    const name = this.kind === "wingsuit" ? "Wingsuit" : "Tracking jump";
    return `${name} · Leg ${Math.min(this.leg + 1, this.legCount)}/${this.legCount}`;
  }
}
