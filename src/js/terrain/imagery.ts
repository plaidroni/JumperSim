import {
  CesiumIonOverlay,
  XYZTilesOverlay,
} from "3d-tiles-renderer/three/plugins";
import {
  CESIUM_ION_TOKEN,
  ION_ASSETS,
  ImageryKey,
  MAPBOX_TOKEN,
} from "./config";

/** Creates the image overlay draped over the terrain for a given map style. */
export function createImageryOverlay(key: ImageryKey) {
  switch (key) {
    case "mapbox-dark":
      return new XYZTilesOverlay({
        url:
          "https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/512/{z}/{x}/{y}" +
          `?access_token=${MAPBOX_TOKEN}`,
        tileDimension: 512,
        levels: 18,
      });
    case "cesium":
    default:
      return new CesiumIonOverlay({
        assetId: ION_ASSETS.worldImagery,
        apiToken: CESIUM_ION_TOKEN,
        autoRefreshToken: true,
      });
  }
}

export const IMAGERY_LABELS: Record<ImageryKey, string> = {
  "mapbox-dark": "Dark (Mapbox)",
  cesium: "Satellite (Cesium)",
};

export const IMAGERY_ATTRIBUTION: Record<ImageryKey, string> = {
  "mapbox-dark": "© Mapbox © OpenStreetMap",
  cesium: "Imagery via Cesium ion",
};
