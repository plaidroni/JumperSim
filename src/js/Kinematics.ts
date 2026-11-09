import * as THREE from "three";
export class KinematicSample {
  time: any;
  position: any;
  velocity: any;
  angle: THREE.Quaternion;
  constructor(
    time,
    position,
    velocity,
    angle: THREE.Quaternion = new THREE.Quaternion()
  ) {
    this.time = time;
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.angle = angle.clone();
  }
}

export class KinematicTrack {
  samples: Array<KinematicSample>;

  constructor() {
    this.samples = [];
  }

  addSample(time, position, velocity, angle: THREE.Quaternion) {
    this.samples.push(new KinematicSample(time, position, velocity, angle));
  }

  editSample(
    time: number,
    position?: THREE.Vector3,
    velocity?: THREE.Vector3,
    angle?: THREE.Quaternion
  ) {
    if (time === undefined || time < 0 || time >= this.samples.length) {
      console.error("Invalid or missing sample index");
      return;
    }

    const sample = this.samples[time];
    if (position !== undefined) sample.position = position;
    if (velocity !== undefined) sample.velocity = velocity;
    if (angle !== undefined) sample.angle = angle;
  }

  getInterpolatedSample(time) {
    if (this.samples.length === 0) return null;
    if (time <= this.samples[0].time) return this.samples[0];
    if (time >= this.samples[this.samples.length - 1].time)
      return this.samples[this.samples.length - 1];

    // binary search: samples are time-ordered but not evenly spaced
    let lo = 0;
    let hi = this.samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.samples[mid].time < time) lo = mid;
      else hi = mid;
    }
    const i = lo;

    const a = this.samples[i];
    const b = this.samples[i + 1];
    const t = (time - a.time) / (b.time - a.time);

    const interpolatedPosition = new THREE.Vector3().lerpVectors(
      a.position,
      b.position,
      t
    );

    const interpolatedVelocity = new THREE.Vector3().lerpVectors(
      a.velocity,
      b.velocity,
      t
    );

    // Slerp the quaternion angle/orientation
    const interpolatedAngle = new THREE.Quaternion().copy(a.angle).slerp(b.angle, t);

    return new KinematicSample(
      time,
      interpolatedPosition,
      interpolatedVelocity,
      interpolatedAngle
    );
  }
}
