import * as THREE from "three";
import { TilesRenderer } from "3d-tiles-renderer/three";
import {
  CesiumIonAuthPlugin,
  CesiumIonOverlay,
  ImageOverlayPlugin,
  QuantizedMeshPlugin,
  ReorientationPlugin,
  TileCompressionPlugin,
  UpdateOnChangePlugin,
} from "3d-tiles-renderer/three/plugins";

const env = import.meta.env;
const CESIUM_WORLD_TERRAIN_ASSET_ID = "1";
const CESIUM_WORLD_IMAGERY_ASSET_ID = "2";
const cesiumIonToken =
  env.VITE_CESIUM_ION_TOKEN || env.CESIUM_ION_TOKEN || "";

export class CesiumTilesRenderer {
  private tiles: TilesRenderer | null = null;

  initialize(
    latitude: number,
    longitude: number,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
  ): THREE.Group {
    if (!cesiumIonToken) {
      throw new Error(
        "Cesium Ion token not set. Set VITE_CESIUM_ION_TOKEN in .env.",
      );
    }

    const tiles = new TilesRenderer();
    tiles.registerPlugin(
      new ReorientationPlugin({
        up: "+y",
        recenter: true,
        lat: latitude,
        lon: longitude,
        height: 0,
      }),
    );
    tiles.registerPlugin(
      new CesiumIonAuthPlugin({
        apiToken: cesiumIonToken,
        assetId: CESIUM_WORLD_TERRAIN_ASSET_ID,
        autoRefreshToken: true,
        assetTypeHandler: (assetType, terrainTiles) => {
          if (assetType === "TERRAIN") {
            terrainTiles.registerPlugin(new QuantizedMeshPlugin({}));
          }
        },
      }),
    );
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new UpdateOnChangePlugin());
    tiles.registerPlugin(
      new ImageOverlayPlugin({
        overlays: [
          new CesiumIonOverlay({
            assetId: CESIUM_WORLD_IMAGERY_ASSET_ID,
            apiToken: cesiumIonToken,
            autoRefreshToken: true,
          }),
        ],
        renderer,
      }),
    );
    tiles.addEventListener("load-error", (event) => {
      console.error("Cesium tile load error:", event.error, event.url);
    });
    tiles.addEventListener("load-root-tileset", (event) => {
      console.info("Cesium root tileset loaded:", event.url);
    });
    tiles.addEventListener("tiles-load-end", () => {
      console.info(
        "Cesium tiles loaded:",
        tiles.activeTiles.size,
        "active,",
        tiles.visibleTiles.size,
        "visible",
      );
    });
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);

    camera.updateMatrixWorld(true);
    tiles.group.updateMatrixWorld(true);

    this.tiles = tiles;
    tiles.update();
    return tiles.group;
  }

  update(): void {
    this.tiles?.update();
  }

  dispose(): void {
    this.tiles?.dispose();
    this.tiles = null;
  }
}