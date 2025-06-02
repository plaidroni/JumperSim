import { MathUtils, Vector3 } from "three";
export function clampVectorAboveYZero(vector) {
  vector.y = MathUtils.clamp(vector.y, 0, Infinity); // Clamp y to be >= 0
  return vector;
}
