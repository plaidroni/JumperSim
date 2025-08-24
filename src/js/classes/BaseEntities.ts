import * as THREE from "three";
import { SimPlane } from "./SimEntities";
import { Formation } from "./Formations";
import { v4 as uuidv4 } from "uuid";

export type SuitType = "baggy" | "skintight" | "normal";
export type FlyingStyle =
  | "freefly"
  | "headdown"
  | "sitfly"
  | "tracking"
  | "belly"
  | "wingsuit";

export class Plane {
  id = uuidv4();
  initialPosition: THREE.Vector3;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  vector: THREE.Vector3;
  speed: number;
  jumpers: Jumper[];
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

  changeDirection(newDirection: THREE.Vector3) {
    this.direction.copy(newDirection.normalize());
    this.vector.copy(this.direction).multiplyScalar(this.speed);
    if (this.mesh) {
      const yaw = Math.atan2(this.direction.x, this.direction.z);
      this.mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    }
  }
  toLoadPanelSummary(jumpers: Jumper[] = []) {
    const order = [...jumpers]
      .sort((a, b) => a.index - b.index)
      .map((j) => j.id);
    return {
      id: this.id,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      initialPosition: {
        x: this.initialPosition.x,
        y: this.initialPosition.y,
        z: this.initialPosition.z,
      },
      direction: {
        x: this.direction.x,
        y: this.direction.y,
        z: this.direction.z,
      },
      // headingDeg: this.getHeadingDeg(),
      // speedKnots: this.getSpeedKnots(),
      jumpersCount: jumpers.length,
      jumpersOrder: order,
    };
  }
}

/**
 * base class to store all logic & data for a jumper. different from SimJumper,
 * as this does none of the displaying nor does it hold a mesh
 */
export class Jumper {
  id = uuidv4();
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
  targetPosition: THREE.Vector3;

  surfaceArea: number; // m^2
  weight: number;
  extraWeight: number;
  suitType: SuitType;
  flyingStyle: FlyingStyle;

  constructor(
    index: number,
    plane: Plane,
    jumpInterval: number | undefined = 15,
    deployDelay: number | undefined = 7,
    canopySize: number | undefined = 190,
    flyingStyle: FlyingStyle | undefined = "belly",
    weight: number | undefined = 80,
    extraWeight: number | undefined = 0,
    suitType: SuitType | undefined = "normal"
  ) {
    this.index = index;
    this.jumpTime = index * jumpInterval;
    this.direction = plane.direction;
    this.deployDelay = deployDelay;
    this.canopySize = canopySize;
    this.plane = plane;
    this.initialVelocity = plane.vector;
    this.position = new THREE.Vector3();
    this.flyingStyle = flyingStyle;
    this.weight = weight;
    this.extraWeight = extraWeight;
    this.suitType = suitType;

    // uses the flying style to figure out the surface area through hardcoded values (for now)
    this.calculateSurfaceArea();

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

  toEditableSummary() {
    return {
      id: this.id,
      planeId: (this.plane as any)?.id,
      index: this.index, // use as load order? (maybe another var)
      name: this.name ?? null,
      jumpTime: this.jumpTime,
      deployDelay: this.deployDelay,
      canopySize: this.canopySize,
      isInFormation: this.isInFormation,
      formationId: (this.formation as any)?.id,
      formationName: (this.formation as any)?.name,
      targetPosition: {
        x: this.targetPosition.x,
        y: this.targetPosition.y,
        z: this.targetPosition.z,
      },
    };
  }

  // depending on the flying style, change the surface area
  // MEASURED IN m^2
  calculateSurfaceArea() {
    switch (this.flyingStyle) {
      case "freefly":
        this.surfaceArea = 0.8;
        break;
      case "headdown":
        this.surfaceArea = 0.35;
        break;
      case "sitfly":
        this.surfaceArea = 0.5;
        break;
      case "tracking":
        this.surfaceArea = 0.45;
        break;
      case "belly":
        this.surfaceArea = 0.8;
        break;
      case "wingsuit":
        this.surfaceArea = 2;
        break;
    }
  }
}
