import * as THREE from "three";
export class KinematicSample {
  time: any;
  position: any;
  velocity: any;
  constructor(time, position, velocity) {
    this.time = time;
    this.position = position.clone();
    this.velocity = velocity.clone();
  }
}

export class KinematicTrack {
  samples: Array<KinematicSample>;

  constructor() {
    this.samples = [];
  }

  addSample(time, position, velocity) {
    this.samples.push(new KinematicSample(time, position, velocity));
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
