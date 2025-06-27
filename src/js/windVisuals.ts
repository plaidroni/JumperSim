import * as THREE from "three";

var canvas = document.createElement("CANVAS");
canvas.width = 64;
canvas.height = 8;

// do we already have context?
var context = canvas.getContext("2d");

var gradient = context.createLinearGradient(0, 0, 64, 0);
gradient.addColorStop(0.0, "rgba(255,255,255,0)");
gradient.addColorStop(0.5, "rgba(255,255,255,128)");
gradient.addColorStop(1.0, "rgba(255,255,255,0)");
context.fillStyle = gradient;
context.fillRect(0, 0, 64, 8);

var texture = new THREE.CanvasTexture(canvas);

export class WindLineObject {}

class WindLines {
  //replace with windlines object
  windLines: Array<any>;
  constructor() {
    this.windLines = new Array();
  }
  getWindLines(): Array<any> {
    return this.windLines;
  }
  constructWindLines() {}
}

export function GenerateWindLines(scene: THREE.Scene) {
  var n = 10, // number of lines
    lines = [];

  for (var i = 0; i < n; i++) {
    var line = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1, 20, 1),
      new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
      })
    );
    line.pos = line.geometry.getAttribute("position");
    line.rnda = Math.random();
    line.rndb = Math.random();
    line.rndc = Math.random();
    line.rndd = Math.random();
    lines.push(line);
  }

  scene.add(...lines);
}

export function flowLine(time, line) {
  time = time / 3000;
  for (var i = 0; i < 42; i++) {
    var t = time + (i % 21) / 60,
      x = 4 * Math.sin(5 * line.rnda * t + 6 * line.rndb),
      y = 4 * Math.cos(5 * line.rndc * t + 6 * line.rndd),
      z =
        elevation(x, y) +
        0.5 +
        0.04 * (i > 20 ? 1 : -1) * Math.cos(((i % 21) - 10) / 8);

    line.pos.setXYZ(i, x, z, -y);
  }
  line.pos.needsUpdate = true;
}

function animationLoop(t) {
  for (var line of lines) flowLine(t, line);

  controls.update();
  light.position.copy(camera.position);
  renderer.render(scene, camera);
}
