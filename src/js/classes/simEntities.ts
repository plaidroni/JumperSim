import * as THREE from "three";
import { Plane, Jumper } from "./baseEntities";
import { KinematicTrack } from "../kinematics";

const v_grav = new THREE.Vector3(0, -9.81, 0);
const drag_air = 1.1;
const p_air_start = 0.82;
const area = 1.84 * 0.4;

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
  constructor(index, plane, jumpInterval, deployDelay, canopySize) {
    super(index, plane, jumpInterval, deployDelay, canopySize);
    this.track = new KinematicTrack();
  }

  precalculate(duration, step = 0.1) {
    const force_drag =
      (1 / 2) * p_air_start * this.initialVelocity ** 2 * drag_air * area;
    this.track.samples = [];
    for (let t = 0; t <= duration; t += step) {
      super.update(t);
      this.track.addSample(t, this.position, new THREE.Vector3()); //compute velocity sm
    }
  }
}
