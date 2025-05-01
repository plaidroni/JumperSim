import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const renderer = new THREE.WebGLRenderer();

renderer.setSize(window.innerWidth, window.innerHeight);

// inject renderer into dom
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// setting up camera
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const controls = new OrbitControls(camera, renderer.domElement);

const axisHelper = new THREE.AxesHelper(5);

scene.add(axisHelper);

camera.position.z = 5;
controls.update();

function animate() {
  requestAnimationFrame(animate);

  // required if controls.enableDamping or controls.autoRotate are set to true
  controls.update();

  renderer.render(scene, camera);
}
animate();
