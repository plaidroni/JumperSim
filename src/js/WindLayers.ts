import * as THREE from "three";
import { convertWeatherSnapshotToWindLayers } from "./Utils";
export function GenerateWindLayers(scene: THREE) {
  const windLayers = convertWeatherSnapshotToWindLayers();
}
