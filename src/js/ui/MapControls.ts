import { getCookie, setCookie } from "../Utils";
import { ImageryKey, MAP_DEFAULTS, isImageryAvailable } from "../terrain/config";
import type { MapOptions, MapScene } from "../terrain/MapScene";

const COOKIE_STYLE = "mapStyle";
const COOKIE_BUILDINGS = "mapBuildings";
const COOKIE_GRID = "mapGrid";

/** Read the user's saved map choices (cookies), falling back to defaults. */
export function readSavedMapOptions(): MapOptions {
  const style = getCookie(COOKIE_STYLE) as ImageryKey | null;
  let imagery: ImageryKey =
    style === "cesium" || style === "mapbox-dark" ? style : MAP_DEFAULTS.imagery;
  if (!isImageryAvailable(imagery)) imagery = "cesium";
  const b = getCookie(COOKIE_BUILDINGS);
  const g = getCookie(COOKIE_GRID);
  return {
    imagery,
    buildings: b === null ? MAP_DEFAULTS.buildings : b === "1",
    showGrid: g === null ? MAP_DEFAULTS.showGrid : g === "1",
  };
}

/** Wire the Map style dropdown and the layer checkboxes to the MapScene. */
export function initMapControls(mapScene: MapScene) {
  const select = document.getElementById(
    "map-style-select",
  ) as HTMLSelectElement | null;
  const buildings = document.getElementById(
    "map-buildings-toggle",
  ) as HTMLInputElement | null;
  const grid = document.getElementById(
    "map-grid-toggle",
  ) as HTMLInputElement | null;

  if (select) {
    const darkOption = select.querySelector(
      'option[value="mapbox-dark"]',
    ) as HTMLOptionElement | null;
    if (darkOption && !isImageryAvailable("mapbox-dark")) {
      darkOption.disabled = true;
      darkOption.textContent = "Dark (Mapbox) – no token";
      select.title = "Mapbox token not set (VITE_MAPBOX_TOKEN in .env)";
      console.warn(
        "Mapbox token not set (VITE_MAPBOX_TOKEN). Map style falls back to Cesium.",
      );
    }
    select.value = mapScene.options.imagery;
    select.addEventListener("change", async () => {
      const key = select.value as ImageryKey;
      if (await mapScene.setImagery(key)) {
        setCookie(COOKIE_STYLE, key, 365);
      } else {
        select.value = mapScene.options.imagery;
      }
    });
    // Mapbox refused the token (see checkMapboxAccess): show it in the dropdown
    window.addEventListener("map-imagery-unavailable", () => {
      if (darkOption) {
        darkOption.disabled = true;
        darkOption.textContent = "Dark (Mapbox) – unavailable";
      }
      select.title = "Mapbox refused the token. Check its URL restrictions.";
      select.value = mapScene.options.imagery;
    });
  }

  if (buildings) {
    buildings.checked = mapScene.options.buildings;
    buildings.addEventListener("change", () => {
      mapScene.setBuildingsEnabled(buildings.checked);
      setCookie(COOKIE_BUILDINGS, buildings.checked ? "1" : "0", 365);
    });
  }

  if (grid) {
    grid.checked = mapScene.options.showGrid;
    grid.addEventListener("change", () => {
      mapScene.setGridVisible(grid.checked);
      setCookie(COOKIE_GRID, grid.checked ? "1" : "0", 365);
    });
  }
}
