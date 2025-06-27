import * as THREE from "three";
import { Plane, Jumper } from "./baseEntities";
import { KinematicTrack } from "../kinematics";

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
      console.log(
        `Plane Sample at t=${t.toFixed(
          2
        )}: position=${this.position.toArray()}, vector=${this.vector.toArray()}`
      );
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

  precalculate(duration, step = 0.1) {
    // --KEEP--
    this.track.samples = [];
    let timeSinceJump = 0;

    const planeSampleAtJump = this.plane.track.getInterpolatedSample(
      this.jumpTime
    );
    let currentPosition = planeSampleAtJump.position.clone();
    this.velocity = planeSampleAtJump.velocity.clone();
    // --END KEEP--
    for (let t = 0; t <= duration; t += step) {
      const simTime = t;

      if (simTime < this.jumpTime) {
        const sample = this.plane.track.getInterpolatedSample(simTime);
        currentPosition = sample.position.clone();
        this.velocity = sample.velocity.clone();
      } else {
        timeSinceJump = simTime - this.jumpTime;
        const deployTime = Math.max(0, timeSinceJump - this.deployDelay);
        const fallTime = Math.min(timeSinceJump, this.deployDelay);

        const dragCoefficient = deployTime > 0 ? 2.5 : drag_air;
        const effectiveArea = deployTime > 0 ? 25 : area;

        const gravity = v_grav.clone().multiplyScalar((window as any).simScale);

        const dragForce = this.velocity
          .clone()
          .multiplyScalar(-1)
          .normalize()
          .multiplyScalar(
            0.5 *
              p_air_start *
              this.velocity.lengthSq() *
              dragCoefficient *
              effectiveArea
          );

        const totalForce = gravity.clone().multiplyScalar(mass).add(dragForce);
        const acceleration = totalForce.clone().divideScalar(mass);

        this.velocity.add(acceleration.clone().multiplyScalar(step));
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
