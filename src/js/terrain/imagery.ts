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
  return guardOverlay(buildOverlay(key));
}

/**
 * 3d-tiles-renderer 0.5.x can report a tile's visibility to an overlay before that
 * overlay has worked out the tile's image region (range is still null while a newly
 * added overlay is loading, e.g. right after switching map style). The overlay then
 * throws inside the tiles update and that exception stops the app's render loop.
 * Skip those early calls: the plugin marks the region visible itself once it is ready.
 */
function guardOverlay<T extends object>(overlay: T): T {
  const o = overlay as any;
  const orig = o.setRegionVisible?.bind(o);
  if (!orig) return overlay;
  o.setRegionVisible = (range: any, ...rest: any[]) => {
    if (!range) return;
    try {
      return orig(range, ...rest);
    } catch (err) {
      // a region hidden more times than shown: harmless, never worth stopping the map
      console.debug("Imagery overlay region bookkeeping skipped", err);
    }
  };
  return overlay;
}

function buildOverlay(key: ImageryKey) {
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

let mapboxCheck: Promise<boolean> | null = null;

/**
 * Request one low-zoom tile to confirm Mapbox accepts the token from this site.
 * A refused token (403: URL restrictions or missing scope) would otherwise leave
 * the terrain untextured and fill the console with image decode errors.
 * The result is cached for the session.
 */
export function checkMapboxAccess(): Promise<boolean> {
  if (!MAPBOX_TOKEN) return Promise.resolve(false);
  mapboxCheck ??= fetch(
    "https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/512/0/0/0" +
      `?access_token=${MAPBOX_TOKEN}`,
  )
    .then((res) => {
      if (!res.ok) {
        console.warn(
          `Mapbox refused the Dark style tiles (HTTP ${res.status}). ` +
            "Check the token's URL restrictions and scopes. Using Cesium imagery.",
        );
      }
      return res.ok;
    })
    .catch((err) => {
      console.warn("Could not reach Mapbox. Using Cesium imagery.", err);
      return false;
    });
  return mapboxCheck;
}

export const IMAGERY_LABELS: Record<ImageryKey, string> = {
  "mapbox-dark": "Dark (Mapbox)",
  cesium: "Satellite (Cesium)",
};

export const IMAGERY_ATTRIBUTION: Record<ImageryKey, string> = {
  "mapbox-dark": "© Mapbox © OpenStreetMap",
  cesium: "Imagery via Cesium ion",
};
