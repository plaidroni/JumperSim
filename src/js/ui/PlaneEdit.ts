import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/Addons.js";

export function StartEditPlane(
  planeMesh: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  height = 250,
  duration = 600,
  handleModifyEditPlane: () => {},
  editingPlane: boolean
): Promise<void> {
  if (!planeMesh || !camera || !controls) return Promise.resolve();

  handleModifyEditPlane();
  const planeWorldQuat = new THREE.Quaternion();
  planeMesh.getWorldQuaternion(planeWorldQuat);

  const forwardWorld = new THREE.Vector3(0, 0, -1).applyQuaternion(
    planeWorldQuat
  );
  forwardWorld.y = 0;
  if (forwardWorld.lengthSq() === 0) forwardWorld.set(0, 0, 1).normalize();
  forwardWorld.normalize();

  const yaw = Math.atan2(forwardWorld.x, forwardWorld.z);

  const planePos = new THREE.Vector3();
  planeMesh.getWorldPosition(planePos);

  const targetPos = planePos.clone().add(new THREE.Vector3(0, height, 0));

  // 1) set up vector so "up" is +Z for a true top-down camera
  // 2) look at the plane
  // 3) rotate around local Z so plane's nose points right (landscape)
  const tmp = new THREE.Object3D();
  tmp.position.copy(targetPos);
  tmp.up.set(0, 0, 1);
  tmp.lookAt(planePos);

  tmp.rotateZ(yaw - Math.PI / 2);

  const startPos = camera.position.clone();
  const startQuat = camera.quaternion.clone();
  const targetQuat = tmp.quaternion.clone();

  const startTarget = controls.target.clone();
  const endTarget = planePos.clone();

  const start = performance.now();

  const ease = (t: number) => t * t * (3 - 2 * t);

  return new Promise<void>((resolve) => {
    function step(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const k = ease(t);

      camera.position.lerpVectors(startPos, targetPos, k);
      camera.quaternion.slerpQuaternions(startQuat, targetQuat, k);

      controls.target.lerpVectors(startTarget, endTarget, k);
      controls.update();

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        // snap final state
        camera.position.copy(targetPos);
        camera.quaternion.copy(targetQuat);
        controls.target.copy(endTarget);
        controls.update();
        editingPlane = false;
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}
