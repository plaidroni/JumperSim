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

  constructor(position, speedKnots, direction) {
    super(position, speedKnots, direction);
    this.track = new KinematicTrack();
  }

  addFormation(formation: Formation) {
    this.formations.push(formation);
  }

  precalculate(duration, step = 0.1) {
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

  constructor(index, plane: SimPlane, jumpInterval, deployDelay, canopySize) {
    super(index, plane, jumpInterval, deployDelay, canopySize);
    this.track = new KinematicTrack();
    this.velocity = plane.vector.clone();
  }

  addLandingSpot() {}

  precalculate(duration, step = 0.01) {
    this.track.samples = [];
    let timeSinceJump = 0;

    const g = 9.81;
    const rho = 1.225;
    const Cd = 1.0;
    const A = this.surfaceArea;
    const mass = this.weight + this.extraWeight;

    const knotsToMs = (knots: number) => knots * 0.514444;

    const windLayers = convertWeatherSnapshotToWindLayers(
      (<any>window).weatherSnapshotLog[0]
    );
    // set quaternion to match formation offset
    console.log(
      `Calculating Jumper Vector for ${this.index} in formation: ${this.isInFormation}`
    );

    function windVectorAt(altitude: number): THREE.Vector3 {
      let lower = windLayers[0];
      // we take 2 wind layers down because we pull 18k and need winds at 14k
      let upper = windLayers[windLayers.length - 2];

      for (let i = 0; i < windLayers.length - 1; i++) {
        if (
          altitude >= windLayers[i].altitude &&
          altitude <= windLayers[i + 1].altitude
        ) {
          lower = windLayers[i];
          upper = windLayers[i + 1];
          break;
        }
      }

      const lowerSpeed = knotsToMs(lower.speedKts);
      const upperSpeed = knotsToMs(upper.speedKts);

      const lowerAngle = THREE.MathUtils.degToRad(lower.angleDeg);
      const upperAngle = THREE.MathUtils.degToRad(upper.angleDeg);

      const lowerVec = new THREE.Vector3(
        lowerSpeed * Math.sin(lowerAngle),
        0,
        lowerSpeed * Math.cos(lowerAngle)
      );
      const upperVec = new THREE.Vector3(
        upperSpeed * Math.sin(upperAngle),
        0,
        upperSpeed * Math.cos(upperAngle)
      );

      const t = (altitude - lower.altitude) / (upper.altitude - lower.altitude);
      return lowerVec.lerp(upperVec, t);
    }

    const planeSampleAtJump = this.plane.track.getInterpolatedSample(
      this.jumpTime
    );
    let currentPosition = planeSampleAtJump
      ? planeSampleAtJump.position.clone().add(this.origin)
      : this.plane.position.clone().add(this.origin);
    this.velocity = planeSampleAtJump
      ? planeSampleAtJump.velocity.clone()
      : this.plane.vector.clone();

    for (let t = 0; t <= duration; t += step) {
      const simTime = t;

      if (simTime < this.jumpTime) {
        const sample = this.plane.track.getInterpolatedSample(simTime);
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
        const dragMag = 0.5 * Cd * rho * A * speed * speed;
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

export function createDefaultSimJumpers(count, plane): SimJumper[] {
  return Array.from(
    { length: count },
    (_, i) => new SimJumper(i, plane, 10, 50, 190)
  );
}
