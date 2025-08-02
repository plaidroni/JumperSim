import * as THREE from "three";
export class KinematicSample {
  time: any;
  position: any;
  velocity: any;
  angle: THREE.Vector3;
  constructor(time, position, velocity, angle = new THREE.Vector3(0, 0, 0)) {
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

  addSample(time, position, velocity, angle) {
    this.samples.push(new KinematicSample(time, position, velocity, angle));
  }

  editSample(
    time: number,
    position?: THREE.Vector3,
    velocity?: THREE.Vector3,
    angle?: THREE.Vector3
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

    let i = 0;
    while (i < this.samples.length - 1 && this.samples[i + 1].time < time) {
      i++;
    }

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

    return new KinematicSample(
      time,
      interpolatedPosition,
      interpolatedVelocity
    );
  }
}
