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
    this.track.samples = [];
    for (let t = 0; t <= duration; t += step) {
      super.update(t);
      this.track.addSample(t, this.position, this.vector);
    }
  }
}

export class SimJumper extends Jumper {
  track: KinematicTrack;
  constructor(
    index,
    plane,
    jumpInterval,
    deployDelay,
    canopySize,
    initialVelocity
  ) {
    super(index, plane, jumpInterval, deployDelay, canopySize);
    this.track = new KinematicTrack();
    this.velocity = plane.vector.clone();
  }

  addLandingSpot() {}

  precalculate(duration, step = 0.1) {
    this.track.samples = [];
    let timeSinceJump = 0;
    let currentPosition = this.plane.initialPosition
      .clone()
      .add(this.plane.vector.clone().multiplyScalar(this.jumpTime));
    this.velocity = this.plane.vector.clone();

    for (let t = 0; t <= duration; t += step) {
      const simTime = t;
      if (simTime < this.jumpTime) {
        currentPosition = this.plane.position.clone();
        this.velocity = this.plane.vector.clone();
      } else {
        timeSinceJump = simTime - this.jumpTime;
        const deployTime = Math.max(0, timeSinceJump - this.deployDelay);
        const fallTime = Math.min(timeSinceJump, this.deployDelay);

        const dragCoefficient = deployTime > 0 ? 2.5 : drag_air;
        const effectiveArea = deployTime > 0 ? 25 : area;

        const gravity = v_grav.clone().multiplyScalar((window as any).simScale);

        // drag = 0.5 * rho * v^2 * Cd * A
        // doesn't fit quite right need to calculate on paper with simscale = 0.1 to test
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
