import { MathUtils, Vector3 } from "three";
export function clampVectorAboveYZero(vector) {
  vector.y = MathUtils.clamp(vector.y, 0, Infinity); // Clamp y to be >= 0
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
