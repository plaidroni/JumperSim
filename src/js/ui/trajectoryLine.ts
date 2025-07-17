import { SimJumper } from "../classes/simEntities";
import * as THREE from "three";
export function createDynamicTrajectoryLine(jumper: SimJumper): THREE.Line {
  const sampleCount = jumper.track.samples.length;

  const positions = new Float32Array(sampleCount * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.LineBasicMaterial({ color: 0xff8800 });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;

  (line as any).jumper = jumper;
  (line as any).renderedSamples = 0;

  return line;
}

function createStatsSprite(jumper: SimJumper): THREE.Sprite {
  console.log("jumper", jumper.track.samples.at(-1));
  const duration = jumper.track.samples.at(0)?.time - jumper.jumpTime;

  const avgSpeed =
    jumper.track.samples
      .map((s) => s.velocity.length())
      .reduce((a, b) => a + b, 0) / jumper.track.samples.length;

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "white";
  ctx.font = "20px Arial";
  ctx.fillText(`Time: ${duration.toFixed(1)}s`, 10, 300);
  ctx.fillText(`Avg: ${avgSpeed.toFixed(1)} m/s`, 10, 600);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture });
  const sprite = new THREE.Sprite(material);

  const lastPos = jumper.track.samples.at(0).position;
  sprite.position.copy(lastPos.clone().add(new THREE.Vector3(0, 5, 0)));
  sprite.scale.set(20, 10, 1);

  return sprite;
}

export function updateTrajectoryLines(
  lines: THREE.Line[],
  elapsedTime: number
) {
  for (const line of lines) {
    const jumper: SimJumper = (line as any).jumper;
    const samples = jumper.track.samples;

    let targetSamples = 0;
    while (
      targetSamples < samples.length &&
      samples[targetSamples].time <= elapsedTime
    ) {
      targetSamples++;
    }

    // update the positions to new buffer target
    const buffer = line.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < targetSamples; i++) {
      const pos = samples[i].position;
      buffer[i * 3 + 0] = pos.x;
      buffer[i * 3 + 1] = pos.y;
      buffer[i * 3 + 2] = pos.z;
    }

    line.geometry.setDrawRange(0, targetSamples);
    line.geometry.attributes.position.needsUpdate = true;

    (line as any).renderedSamples = targetSamples;
  }
}

export function visualizeJumpers(jumpers: SimJumper[], scene: THREE.Scene) {
  for (const jumper of jumpers) {
    const statsSprite = createStatsSprite(jumper);
    scene.add(statsSprite);
  }
}
