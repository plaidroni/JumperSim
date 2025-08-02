import * as THREE from "three";
import { WeatherSnapshot } from "../apidata/OpenMateo";
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

const pressureToAltitude: Record<string, number> = {
  "1000hPa": 110, // in meters
  "975hPa": 350,
  "950hPa": 610,
  "925hPa": 760,
  "900hPa": 1000,
  "850hPa": 1460,
  "800hPa": 2000,
  "750hPa": 2500,
  "700hPa": 3100,
};

export function convertWeatherSnapshotToWindLayers(snapshot: WeatherSnapshot) {
  const windLayers: Array<any> = [];

  for (const [pressure, speedStr] of Object.entries(snapshot.windSpeeds)) {
    const directionStr = snapshot.windDirections[pressure];
    const altitude = pressureToAltitude[pressure.replace(":", "")];

    if (!altitude || !speedStr || !directionStr) continue;

    const speedMph = parseFloat(speedStr.replace(/[^\d.]/g, ""));
    const angleDeg = parseFloat(directionStr.replace(/[^\d.]/g, ""));
    const speedKts = speedMph * 0.868976;

    windLayers.push({
      altitude,
      angleDeg,
      speedKts,
    });
  }

  return windLayers.sort((a, b) => a.altitude - b.altitude);
}
