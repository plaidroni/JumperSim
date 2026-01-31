import * as THREE from "three";
import { Plane, Jumper } from "./BaseEntities";
import { KinematicTrack } from "../Kinematics";
import { convertWeatherSnapshotToWindLayers } from "../Utils";
import { clamp } from "three/src/Three.TSL.js";
import { Formation } from "./Formations"; // add this import

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
    const rho0 = 1.225; // sea-level density kg/m^3
    const Cd = 1.0;
    const A = this.surfaceArea;
    const mass = this.weight + this.extraWeight;

    const knotsToMs = (knots: number) => knots * 0.514444;

    const windLayers = convertWeatherSnapshotToWindLayers(
      (<any>window).weatherSnapshotLog[0]
    );

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

    // Build arrays of altitudes (ft) and u/v components (m/s) so we interpolate components
    const layerAltsFt: number[] = [];
    const layerU_mps: number[] = []; // east
    const layerV_mps: number[] = []; // north

    for (const L of windLayers) {
      layerAltsFt.push(L.altitude);
      const sp = knotsToMs(L.speedKts);
      const theta = THREE.MathUtils.degToRad(L.angleDeg);
      // Using meteorological convention: degrees clockwise from North -> u = s * sin(theta), v = s * cos(theta)
      layerU_mps.push(sp * Math.sin(theta));
      layerV_mps.push(sp * Math.cos(theta));
    }

    // Linear interpolation function that clamps/extrapolates (we'll clamp to nearest for outside range)
    function interpComponent(
      alts: number[],
      comps: number[],
      queryAltFt: number
    ) {
      if (queryAltFt <= alts[0]) return comps[0];
      if (queryAltFt >= alts[alts.length - 1]) return comps[comps.length - 1];
      // find bracket
      for (let i = 0; i < alts.length - 1; i++) {
        const a0 = alts[i];
        const a1 = alts[i + 1];
        if (queryAltFt >= a0 && queryAltFt <= a1) {
          const t = (queryAltFt - a0) / (a1 - a0);
          return comps[i] * (1 - t) + comps[i + 1] * t;
        }
      }
      return comps[comps.length - 1]; // fallback
    }

    // Exponential smoothing helper for wind (in m/s)
    const windSmoothingTau = 0.5; // seconds, tweakable (smaller = less smoothing)
    let windPrev = new THREE.Vector3(0, 0, 0);

    function windVectorAt(altitudeMeters: number): THREE.Vector3 {
      // windLayers altitudes are in ft, so convert
      const altFt = metersToFeet(altitudeMeters);

      // Interpolate components
      const u = interpComponent(layerAltsFt, layerU_mps, altFt);
      const v = interpComponent(layerAltsFt, layerV_mps, altFt);

      // convert to THREE Vector3 (east, up=0, north)
      const w = new THREE.Vector3(u, 0, v);

      // simple exponential smoothing in time: alpha = dt/(tau+dt)
      // but we don't have dt here; smoothing will be applied in the main loop where dt is known.
      return w;
    }

    const planeSampleAtJump = (
      this.plane as SimPlane
    ).track.getInterpolatedSample(this.jumpTime);
    let currentPosition = planeSampleAtJump
      ? planeSampleAtJump.position.clone().add(this.origin)
      : this.plane.position.clone().add(this.origin);
    // Tracking behavior parameters
    const trackingStartAltitudeM = feetToMeters(4500);
    const trackingRatio = 1.0; // horizontal tracking speed = |Vy| * ratio
    let trackingStarted = false;
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

        const wind = windVectorAt(currentPosition.y);
        const relativeVelocity = this.velocity.clone().sub(wind);

        const speed = relativeVelocity.length();
        const dragMag = 0.5 * Cd * rho0 * A * speed * speed;
        const drag = relativeVelocity
          .clone()
          .normalize()
          .multiplyScalar(-dragMag);
        const gravity = new THREE.Vector3(0, -mass * g, 0);
        const netForce = gravity.clone().add(drag);
        // console.log("jumper angle:", this.angle);

        const acceleration = netForce.clone().divideScalar(mass);
        this.velocity.add(acceleration.multiplyScalar(step));
        currentPosition.add(this.velocity.clone().multiplyScalar(step));

        // TODO: edit quaternion of mesh to match velocity direction when on the "hill" and speeding up to terminal

        // Start tracking behavior at/below 4500 ft (~1371.6 m)
        if (!trackingStarted && currentPosition.y <= trackingStartAltitudeM) {
          trackingStarted = true;
        }

        if (trackingStarted) {
          // Horizontal tracking speed proportional to vertical speed magnitude
          const verticalSpeed = Math.abs(this.velocity.y);
          const trackingSpeed = verticalSpeed * trackingRatio;
          // Set horizontal velocity to tracking direction plus wind; keep vertical from physics
          const desiredHoriz = trackingDir
            .clone()
            .multiplyScalar(trackingSpeed);
          this.velocity.x = desiredHoriz.x + wind.x;
          this.velocity.z = desiredHoriz.z + wind.z;

          // Debug arrow: indicate intended tracking direction (on the jumper mesh)
          try {
            if (!this.debugArrow) {
              const length = THREE.MathUtils.clamp(trackingSpeed, 1, 8);
              this.debugArrow = new THREE.ArrowHelper(
                desiredHoriz.clone().setY(0).normalize(),
                new THREE.Vector3(0, 0, 0),
                length,
                this.debugArrowColor
              );
              this.getMesh()?.add(this.debugArrow);
            } else {
              const length = THREE.MathUtils.clamp(trackingSpeed, 1, 8);
              this.debugArrow.setDirection(
                desiredHoriz.clone().setY(0).normalize()
              );
              this.debugArrow.setLength(length, length * 0.2, length * 0.2);
              this.debugArrow.position.set(0, 0, 0);
              (this.debugArrow as any).visible = true;
            }
          } catch {}
        }

        if (currentPosition.y < 0) {
          currentPosition.y = 0;
          this.velocity.set(0, 0, 0);
          this.hasLanded = true;
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
