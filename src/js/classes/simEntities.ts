import * as THREE from "three";
import { Plane, Jumper } from "./baseEntities";
import { KinematicTrack } from "../kinematics";

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
    this.track.samples = [];
    for (let t = 0; t <= duration; t += step) {
      super.update(t);
      this.track.addSample(t, this.position, new THREE.Vector3()); //compute velocity sm
    }
  }
}
