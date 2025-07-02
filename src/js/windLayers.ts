import * as THREE from "three";
import { convertWeatherSnapshotToWindLayers } from "./utils";
export function GenerateWindLayers(scene: THREE) {
  const windLayers = convertWeatherSnapshotToWindLayers();
}
