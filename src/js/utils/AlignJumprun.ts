/**
 * Function to align the plane to the jumprun direction (typically parallel to the runway).
 * we will use points on the scene plane and calculate the direction vector, then run plane.changeDirection.
 * Find points through using user input on raycasted lines that hit the scene plane.
 */
import * as THREE from "three";
import { SimPlane } from "../classes/SimEntities";
// this function should be listening for two clicks at different points on the scene plane
export function setJumprunPoints(point1: THREE.Vector3, point2: THREE.Vector3) {
  if (!point1 || !point2) {
    console.error("Invalid points");
    return;
  }
}

export function alignPlaneToJumprun(
  plane: SimPlane,
  point1: THREE.Vector3,
  point2: THREE.Vector3
) {
  try {
    console.log("Aligning plane to jumprun direction...");
    const direction = new THREE.Vector3()
      .subVectors(point2, point1)
      .normalize();

    plane.changeDirection(direction);

    plane.position.copy(point1);
  } catch (error) {
    console.error("Error aligning plane to jumprun:", error);
  }
}
