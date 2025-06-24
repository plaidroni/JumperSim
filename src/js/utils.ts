import * as THREE from "three";
export function clampVectorAboveYZero(vector) {
  vector.y = THREE.MathUtils.clamp(vector.y, 0, Infinity); // Clamp y to be >= 0
  return vector;
}

export function setCookie(name: string, value: string, days = 7) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(
    value
  )}; expires=${expires}; path=/`;
}

export function getCookie(name: string): string | null {
  return document.cookie.split("; ").find((row) => row.startsWith(name + "="))
    ? decodeURIComponent(
        document.cookie
          .split("; ")
          .find((row) => row.startsWith(name + "="))!
          .split("=")[1]
      )
    : null;
}

export function latLonToOffset(lat, lon, centerLat, centerLon) {
  const earthRadius = 6371000; // meters
  const dLat = (lat - centerLat) * (Math.PI / 180);
  const dLon = (lon - centerLon) * (Math.PI / 180);

  const x = dLon * earthRadius * Math.cos((centerLat * Math.PI) / 180);
  const z = -dLat * earthRadius;

  return new THREE.Vector3(x, 0, z);
}
