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
