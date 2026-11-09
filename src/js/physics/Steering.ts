import * as THREE from "three";

/**
 * Air heading that makes the ground track point along `track` (unit, horizontal)
 * at the given airspeed, by cancelling the crosswind. When the crosswind is stronger
 * than the airspeed, just point along the track.
 */
export function crabHeading(track: THREE.Vector3, airspeed: number, wind: THREE.Vector3): THREE.Vector3 {
  const t = track.clone().setY(0);
  if (t.lengthSq() < 1e-12) return t.set(0, 0, 1);
  t.normalize();
  const along = wind.x * t.x + wind.z * t.z;
  const cross = new THREE.Vector3(wind.x - along * t.x, 0, wind.z - along * t.z);
  const c = cross.length();
  if (c >= airspeed || airspeed <= 0) return t;
  return t.multiplyScalar(Math.sqrt(airspeed * airspeed - c * c)).sub(cross).normalize();
}

/** Crab-corrected heading toward a point. */
export function headingToward(
  from: THREE.Vector3,
  to: { x: number; z: number },
  airspeed: number,
  wind: THREE.Vector3,
): THREE.Vector3 {
  return crabHeading(new THREE.Vector3(to.x - from.x, 0, to.z - from.z), airspeed, wind);
}

/** Rotate a horizontal unit vector by `deg` (positive = clockwise seen from above). */
export function rotateHeading(v: THREE.Vector3, deg: number): THREE.Vector3 {
  // world z points south, so clockwise from above is a positive rotation in (x, z)
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return new THREE.Vector3(v.x * c - v.z * s, 0, v.x * s + v.z * c);
}
