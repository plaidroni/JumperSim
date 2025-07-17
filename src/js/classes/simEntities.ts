import * as THREE from "three";
import { Plane, Jumper } from "./baseEntities";
import { KinematicTrack } from "../kinematics";
import { convertWeatherSnapshotToWindLayers } from "../utils";

const v_grav = new THREE.Vector3(0, -9.81, 0);
const drag_air = 0.2;
const p_air_start = 0.82;
const area = 1.84 * 0.4;
const mass = 80;

export class SimPlane extends Plane {
  track: KinematicTrack;
  constructor(position, speedKnots, direction) {
    super(position, speedKnots, direction);
    this.track = new KinematicTrack();
  }

  precalculate(duration, step = 0.1) {
    console.log("Calculating Plane Vector");

    this.track.samples = [];
    for (let t = 0; t <= duration; t += step) {
      super.update(t);
      // console.log(
      //   `Plane Sample at t=${t.toFixed(
      //     2
      //   )}: position=${this.position.toArray()}, vector=${this.vector.toArray()}`
      // );
      this.track.addSample(t, this.position, this.vector);
    }
  }
}

export class SimJumper extends Jumper {
  track: KinematicTrack;
  formationOffset: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  isInFormation: boolean = false;
  hasLanded: boolean;
  hasJumped: boolean;

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
    const A = 0.7;
    const mass = 80;

    const knotsToMs = (knots: number) => knots * 0.514444;

    // const windLayers = [
    //   { altitude: 300, angleDeg: 100.89, speedKts: 5 },
    //   { altitude: 1200, angleDeg: 281.31, speedKts: 5 },
    //   { altitude: 2000, angleDeg: 282.99, speedKts: 5 },
    //   { altitude: 2500, angleDeg: 100.56, speedKts: 12 },
    // ];
    const windLayers = convertWeatherSnapshotToWindLayers(
      (<any>window).weatherSnapshotLog[0]
    );

    function windVectorAt(altitude: number): THREE.Vector3 {
      let lower = windLayers[0];
      let upper = windLayers[windLayers.length - 1];

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
    let currentPosition = planeSampleAtJump.position.clone();
    this.velocity = planeSampleAtJump.velocity.clone();

    for (let t = 0; t <= duration; t += step) {
      const simTime = t;

      if (simTime < this.jumpTime) {
        const sample = this.plane.track.getInterpolatedSample(simTime);
        currentPosition = sample.position.clone();
        this.velocity = sample.velocity.clone();
      } else {
        this.hasJumped = true;
        timeSinceJump = simTime - this.jumpTime;

        const wind = windVectorAt(currentPosition.y);
        const relativeVelocity = this.velocity.clone().sub(wind);

        const speed = relativeVelocity.length();
        const dragMag = 0.5 * Cd * rho * A * speed * speed;
        // if (simTime >= this.jumpTime && Math.abs(simTime % 0.5) < 1e-6) {
        //   console.log(
        //     `t=${simTime.toFixed(1)}s: v=${this.velocity
        //       .length()
        //       .toFixed(2)} m/s, alt=${currentPosition.y.toFixed(2)}m`
        //   );
        // }
        const drag = relativeVelocity
          .clone()
          .normalize()
          .multiplyScalar(-dragMag);
        const gravity = new THREE.Vector3(0, -mass * g, 0);
        const netForce = gravity.clone().add(drag);

        const acceleration = netForce.clone().divideScalar(mass);
        this.velocity.add(acceleration.multiplyScalar(step));
        currentPosition.add(this.velocity.clone().multiplyScalar(step));

        if (currentPosition.y < 0) {
          currentPosition.y = 0;
          this.velocity.set(0, 0, 0);
          this.hasLanded = true;
        }
      }

      this.track.addSample(
        simTime,
        currentPosition.clone(),
        this.velocity.clone()
      );
    }
  }
}

// FormationJumpLoader.js
function computeFormationOffsets(slots) {
  const center2D = slots.reduce(
    (acc, slot) => {
      acc.x += slot.origin[0];
      acc.y += slot.origin[1];
      return acc;
    },
    { x: 0, y: 0 }
  );
  center2D.x /= slots.length;
  center2D.y /= slots.length;

  return slots.map((slot) => {
    const angleRad = THREE.MathUtils.degToRad(slot.angleDeg);
    const offsetX = (slot.origin[0] - center2D.x) * 0.2;
    const offsetZ = (slot.origin[1] - center2D.y) * 0.2;

    const offset = new THREE.Vector3(offsetX, 0, offsetZ);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angleRad);
    return offset;
  });
}

export function loadFormationSequence(
  formationData,
  plane,
  duration = 120,
  step = 0.01
) {
  const { jumpers: jumperConfigs, points } = formationData;
  const firstPoint = points[0];
  const slots = firstPoint.slots;

  const offsets = computeFormationOffsets(slots);
  const simJumpers = [];

  for (let i = 0; i < jumperConfigs.length; i++) {
    const jumperData = jumperConfigs[i];
    const offset = offsets[i];
    if (!offset) continue;

    const jumper = new SimJumper(i, plane, 0, 7, 190);
    jumper.formationOffset = offset;
    jumper.mesh.material.color.set(jumperData.color);
    jumper.isInFormation = true;
    jumper.precalculate(duration, step);
    simJumpers.push(jumper);
  }

  return simJumpers;
}

export function createDefaultSimJumpers(count, plane) {
  return Array.from(
    { length: count },
    (_, i) => new SimJumper(i, plane, 10, 50, 190)
  );
}
