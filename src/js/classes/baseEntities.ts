import * as THREE from "three";
import { SimPlane } from "./SimEntities";
import { Formation } from "./Formations";

export class Plane {
  initialPosition: THREE.Vector3;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  vector: THREE.Vector3;
  speed: number;
  jumpersLeft: number;
  mesh: THREE.Object3D | null = null;

  constructor(
    position: THREE.Vector3,
    speedKnots = (window as any).devConsoleVars.planeSpeed,
    direction = new THREE.Vector3(1, 0, 0)
  ) {
    this.initialPosition = position.clone();
    this.position = position.clone();
    this.direction = direction.normalize();
    // this.speed = speedKnots * 0.51444 * (window as any).simScale;
    this.speed = speedKnots * 0.51444;
    this.vector = this.direction.clone().multiplyScalar(this.speed);
  }

  update(simulationTime: number) {
    this.position.copy(
      this.initialPosition
        .clone()
        .add(this.vector.clone().multiplyScalar(simulationTime))
    );
    if (this.mesh) this.mesh.position.copy(this.position);
  }

  setMesh(mesh: THREE.Object3D) {
    this.mesh = mesh;
    this.mesh.position.copy(this.position);
  }

  getMesh(): THREE.Object3D | null {
    return this.mesh;
  }
}

export class Jumper {
  index: number;
  jumpTime: number;
  deployDelay: number;
  canopySize: number;
  direction: THREE.Vector3;
  plane: SimPlane;
  initialVelocity: THREE.Vector3;
  mesh: THREE.Mesh;
  deployed: boolean;
  position: THREE.Vector3;
  currentVelocity: THREE.Vector3;
  velocity: THREE.Vector3;
  isInFormation: boolean = false;
  formation: Formation;
  name: String;
  height: number;
  area: number;
  targetPosition: THREE.Vector3;

  constructor(
    index: number,
    plane: Plane,
    jumpInterval = 15,
    deployDelay = 7,
    canopySize = 190
  ) {
    this.index = index;
    this.jumpTime = index * jumpInterval;
    this.direction = plane.direction;
    this.deployDelay = deployDelay;
    this.canopySize = canopySize;
    this.plane = plane;
    this.initialVelocity = plane.vector;
    this.position = new THREE.Vector3();
    /**
     * this is used for finding the target position that the jumper wants to be in.
     * It is not used for the actual position of the jumper, but rather for the precalculate function to find the minimum distance to the target.
     * For example, the jumper may want to be in a formation and they will apply forward thrust (tracking) to reach that position.
     */
    this.targetPosition = new THREE.Vector3();

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff0000 })
    );
  }

  update(simulationTime: number) {
    if (simulationTime < this.jumpTime) {
      this.position.copy(this.plane.position);
    } else {
      const timeSinceJump = simulationTime - this.jumpTime;
      const deployTime = Math.max(0, timeSinceJump - this.deployDelay);
      const fallTime = Math.min(timeSinceJump, this.deployDelay);

      // const gravity = new THREE.Vector3(0, -9.81 * (window as any).simScale, 0);
      const gravity = new THREE.Vector3(0, -9.81, 0);
      const canopyDescentRate = new THREE.Vector3(
        0,
        // -2.5 * (window as any).simScale,
        -2.5,
        0
      );

      const freefall = gravity
        .clone()
        .multiplyScalar(0.5 * fallTime * fallTime);
      const canopyFall = canopyDescentRate.clone().multiplyScalar(deployTime);
      const totalFall = freefall.add(canopyFall);

      this.position.copy(
        this.plane.initialPosition
          .clone()
          .add(this.plane.vector.clone().multiplyScalar(this.jumpTime))
          .add(totalFall)
      );
      this.position.y = Math.max(0, this.position.y);
    }

    this.mesh.position.copy(this.position);
  }

  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  setMesh(mesh: THREE.Object3D) {
    this.mesh = mesh;
    this.mesh.position.copy(this.position);
  }
}
