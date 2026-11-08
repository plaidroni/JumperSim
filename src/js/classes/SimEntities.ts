import * as THREE from "three";
import { Plane, Jumper } from "./BaseEntities";
import { KinematicTrack } from "../Kinematics";
import { currentWindProfile, windAtHeight } from "../wind/WindProfile";
import { clamp } from "three/src/Three.TSL.js";
import { Formation } from "./Formations"; // add this import
import { getGroundHeight } from "../terrain/GroundHeight";
import {
  AIR_DENSITY,
  BODY_POSITIONS,
  DRAG_COEFFICIENT,
  GLIDE_TAU_S,
  TRACK_SPEC,
  TRACK_START_FT,
  normalizeBodyPosition,
} from "../physics/BodyPositions";

const v_grav = new THREE.Vector3(0, -9.81, 0);
const drag_air = 0.2;
const p_air_start = 0.82;
const area = 1.84 * 0.4;
const mass = 80;

export class SimPlane extends Plane {
  track: KinematicTrack;
  formations: Formation[] = [];
  jumpers: SimJumper[] = [];
  // UI state holder, assigned at runtime to avoid circular imports
  planeLoad?: any;

  constructor(
    position: THREE.Vector3,
    speedKnots: number,
    direction: THREE.Vector3
  ) {
    super(position, speedKnots, direction);
    this.track = new KinematicTrack();
  }

  addFormation(formation: Formation) {
    this.formations.push(formation);
  }

  precalculate(duration: number, step = 0.1) {
    console.log("Calculating Plane Vector");

    const originalPosition = this.position.clone();

    this.track.samples = [];
    for (let t = 0; t <= duration; t += step) {
      super.update(t);
      // derive yaw quaternion from direction vector (assumes +Z forward)
      const yaw = Math.atan2(this.direction.x, this.direction.z);
      const quat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        yaw
      );
      this.track.addSample(t, this.position, this.vector, quat);
    }
    this.position.copy(originalPosition);
    if (this.mesh) this.mesh.position.copy(originalPosition);
    console.log("Calculating Formation Vectors");
  }

  getFormationsSummary() {
    return this.formations.map((f: any) => ({
      id: f?.id,
      name: f?.name,
      size: f?.members ? f.members.length : undefined,
      // add other fields if your Formation type exposes them (e.g., anchor, slots)
    }));
  }

  buildLoadPanelData(jumpers: SimJumper[]) {
    const jumpersSorted = [...jumpers].sort((a, b) => a.index - b.index);
    const jumperSummaries = jumpersSorted.map((j) => j.toEditableSummary());
    return {
      plane: this.toLoadPanelSummary(jumpersSorted),
      formations: this.getFormationsSummary(),
      jumpers: jumperSummaries,
      loadOrder: jumperSummaries.map((j) => j.id),
    };
  }
}

export class SimJumper extends Jumper {
  track: KinematicTrack;
  formationOffset: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  origin: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  hasLanded: boolean;
  hasJumped: boolean;
  angle: THREE.Quaternion = new THREE.Quaternion();
  // Debug: arrow indicating intended tracking direction
  debugArrow: THREE.ArrowHelper | null = null;
  debugArrowColor: number = 0x00ff00;
  /** Sim time the jumper started tracking (null if they never track). Set by precalculate. */
  trackStartTime: number | null = null;
  /** Sim time the jumper landed (null if not within the precalculated window). */
  landTime: number | null = null;

  constructor(
    index: number,
    plane: SimPlane,
    jumpInterval: number,
    deployDelay: number,
    canopySize: number
  ) {
    super(index, plane, jumpInterval, deployDelay, canopySize);
    this.track = new KinematicTrack();
    this.velocity = plane.vector.clone();
    this.hasJumped = false;
    this.hasLanded = false;
  }

  addLandingSpot() {}

  precalculate(duration: number, step = 0.01) {
    this.track.samples = [];
    let timeSinceJump = 0;

    const g = 9.81;
    const rho0 = AIR_DENSITY; // kg/m^3 (constant; see physics/BodyPositions.ts)
    const Cd = DRAG_COEFFICIENT;
    this.calculateSurfaceArea(); // keep area in sync with the body position
    const position = normalizeBodyPosition(this.flyingStyle);
    const spec = BODY_POSITIONS[position];
    const isWingsuit = position === "wingsuit";
    const tracks = this.tracking && spec.canTrack;
    const mass = this.weight + this.extraWeight;
    this.trackStartTime = null;
    this.landTime = null;
    this.hasLanded = false;
    if (this.debugArrow) (this.debugArrow as any).visible = false;

    const knotsToMs = (knots: number) => knots * 0.514444;

    // Same profile the wind tower draws: metres above the DZ, downwind vectors,
    // +X east / -Z north (see wind/WindProfile.ts)
    const windProfile = currentWindProfile();

    console.log(
      `Calculating Jumper Vector for ${this.index} in formation: ${this.isInFormation}`
    );

    // ----- helpers -----
    const feetToMeters = (ft: number) => ft * 0.3048;
    const metersToFeet = (m: number) => m / 0.3048;

    // simple ISA-like exponential falloff for density (h in meters)
    function rhoAt(hMeters: number) {
      const scale = 8000.0; // scale height ~ 8000 m
      return rho0 * Math.exp(-hMeters / scale);
    }

    // Exponential smoothing helper for wind (in m/s)
    const windSmoothingTau = 0.5; // seconds, tweakable (smaller = less smoothing)
    let windPrev = new THREE.Vector3(0, 0, 0);

    function windVectorAt(altitudeMeters: number): THREE.Vector3 {
      return windAtHeight(windProfile, altitudeMeters);
    }

    const planeSampleAtJump = (
      this.plane as SimPlane
    ).track.getInterpolatedSample(this.jumpTime);
    let currentPosition = planeSampleAtJump
      ? planeSampleAtJump.position.clone().add(this.origin)
      : this.plane.position.clone().add(this.origin);
    // Tracking / gliding parameters
    const trackingStartAltitudeM = feetToMeters(TRACK_START_FT);
    let trackingStarted = false;
    const glideBlend = 1 - Math.exp(-step / GLIDE_TAU_S);
    // Determine the intended horizontal tracking direction
    const jumpRunDir = new THREE.Vector3(
      this.plane.direction.x,
      0,
      this.plane.direction.z
    ).normalize();
    const defaultPerp = new THREE.Vector3(-jumpRunDir.z, 0, jumpRunDir.x);
    let trackingDir = defaultPerp.clone();
    if (trackingDir.lengthSq() < 1e-6) trackingDir.set(1, 0, 0);
    // If in a formation with other members, compute outward from formation center using initial origins
    if (this.isInFormation && (this as any).formation) {
      const formation = (this as any).formation;
      const allJumpers: SimJumper[] = (
        (this.plane as SimPlane).jumpers || []
      ).filter((j: any) => j && (j as any).formation === formation);
      const S = allJumpers.length;
      // Establish a stable per-formation index for alternating directions
      const localOrder = [...allJumpers].sort(
        (a, b) => a.index - b.index || (a.id > b.id ? 1 : -1)
      );
      const localIndex = Math.max(
        0,
        localOrder.findIndex((x) => x.id === (this as any).id)
      );
      if (S >= 3) {
        const center = allJumpers.reduce(
          (acc, j) => {
            acc.x += j.origin.x;
            acc.z += j.origin.z;
            return acc;
          },
          { x: 0, z: 0 }
        );
        center.x /= S;
        center.z /= S;
        let dirX = this.origin.x - center.x;
        let dirZ = this.origin.z - center.z;
        let mag = Math.hypot(dirX, dirZ);
        if (mag < 1e-6) {
          // Fallback: derive a radial direction using per-formation index
          const theta = (2 * Math.PI * localIndex) / S;
          dirX = Math.cos(theta);
          dirZ = Math.sin(theta);
          mag = 1;
        }
        trackingDir.set(dirX / mag, 0, dirZ / mag);
      } else if (S === 2) {
        // Two-way: opposite directions perpendicular to jumprun
        const sign = localIndex === 0 ? 1 : -1;
        trackingDir.copy(defaultPerp).multiplyScalar(sign).normalize();
      } else {
        // Solo within 'formation' (edge): perpendicular default
        trackingDir.copy(defaultPerp).normalize();
      }
    } else {
      // Not in formation: perpendicular to jumprun
      trackingDir.copy(defaultPerp).normalize();
    }
    this.velocity = planeSampleAtJump
      ? planeSampleAtJump.velocity.clone()
      : this.plane.vector.clone();

    for (let t = 0; t <= duration; t += step) {
      const simTime = t;

      if (simTime < this.jumpTime) {
        const sample = (this.plane as SimPlane).track.getInterpolatedSample(
          simTime
        );
        if (sample) {
          currentPosition = sample.position.clone();
          this.velocity = sample.velocity.clone();
        }
      } else {
        this.hasJumped = true;
        timeSinceJump = simTime - this.jumpTime;

        if (this.hasLanded) {
          // stay put on the ground
          this.velocity.set(0, 0, 0);
        } else {
          const wind = windVectorAt(currentPosition.y);

          // Break off and track below TRACK_START_FT (if this jumper tracks)
          if (tracks && !trackingStarted && currentPosition.y <= trackingStartAltitudeM) {
            trackingStarted = true;
            this.trackStartTime = simTime;
          }
          const gliding = isWingsuit || trackingStarted;
          const A = trackingStarted ? TRACK_SPEC.dragAreaM2 : spec.dragAreaM2;
          const k = 0.5 * Cd * rho0 * A; // drag = k·v²

          if (!gliding) {
            // Plain freefall: drag opposes the full air-relative velocity, so the exit
            // throw bleeds off naturally while the jumper drifts with the wind.
            const relativeVelocity = this.velocity.clone().sub(wind);
            const speed = relativeVelocity.length();
            const drag = relativeVelocity
              .clone()
              .normalize()
              .multiplyScalar(-k * speed * speed);
            const acceleration = drag
              .divideScalar(mass)
              .add(new THREE.Vector3(0, -g, 0));
            this.velocity.add(acceleration.multiplyScalar(step));
          } else {
            // Gliding (track or wingsuit): drag sets the fall rate from the vertical
            // speed, and the body converts it into forward speed at the glide ratio.
            const vy = this.velocity.y;
            const ay = -g + (k * vy * vy * (vy < 0 ? 1 : -1)) / mass;
            this.velocity.y += ay * step;

            const glide = isWingsuit ? spec.glideRatio : TRACK_SPEC.glideRatio;
            const horizSpeed = Math.abs(this.velocity.y) * glide;
            const targetX = trackingDir.x * horizSpeed + wind.x;
            const targetZ = trackingDir.z * horizSpeed + wind.z;
            // ease into the new horizontal speed rather than snapping to it
            this.velocity.x += (targetX - this.velocity.x) * glideBlend;
            this.velocity.z += (targetZ - this.velocity.z) * glideBlend;

            // Debug arrow: intended glide direction (on the jumper mesh)
            try {
              const length = THREE.MathUtils.clamp(horizSpeed, 1, 8);
              if (!this.debugArrow) {
                this.debugArrow = new THREE.ArrowHelper(
                  trackingDir.clone(),
                  new THREE.Vector3(0, 0, 0),
                  length,
                  this.debugArrowColor
                );
                this.getMesh()?.add(this.debugArrow);
              } else {
                this.debugArrow.setDirection(trackingDir.clone());
                this.debugArrow.setLength(length, length * 0.2, length * 0.2);
                this.debugArrow.position.set(0, 0, 0);
                (this.debugArrow as any).visible = true;
              }
            } catch {}
          }

          currentPosition.add(this.velocity.clone().multiplyScalar(step));

          const groundY = getGroundHeight(currentPosition.x, currentPosition.z);
          if (currentPosition.y < groundY) {
            currentPosition.y = groundY;
            this.velocity.set(0, 0, 0);
            this.hasLanded = true;
            this.landTime = simTime;
          }
        }
      }

      this.track.addSample(
        simTime,
        currentPosition.clone(),
        this.velocity.clone(),
        this.angle.clone()
      );
    }
  }
}

export function createDefaultSimJumpers(
  count: number,
  plane: SimPlane
): SimJumper[] {
  return Array.from(
    { length: count },
    (_, i) => new SimJumper(i, plane, 10, 50, 190)
  );
}
