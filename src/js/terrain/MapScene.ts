import * as THREE from "three";
import { TilesRenderer } from "3d-tiles-renderer/three";
import {
  CesiumIonAuthPlugin,
  ImageOverlayPlugin,
  LoadRegionPlugin,
  QuantizedMeshPlugin,
  ReorientationPlugin,
  SphereRegion,
  TileCompressionPlugin,
  UpdateOnChangePlugin,
} from "3d-tiles-renderer/three/plugins";
import { HeightAxis } from "../ui/HeightAxis";
import {
  CESIUM_ION_TOKEN,
  ION_ASSETS,
  ImageryKey,
  MAP_DEFAULTS,
  THEME,
  isImageryAvailable,
} from "./config";
import {
  checkMapboxAccess,
  createImageryOverlay,
  IMAGERY_ATTRIBUTION,
} from "./imagery";
import { notificationManager } from "../classes/NotificationManager";
import { GroundHeightField } from "./GroundHeightField";
import { setGroundProvider } from "./GroundHeight";
import { WindTower } from "../wind/WindTower";

export interface DropzoneLike {
  name: string;
  latitude: number;
  longitude: number;
}

export interface MapOptions {
  imagery: ImageryKey;
  buildings: boolean;
  showGrid: boolean;
  showWind: boolean;
}

const PLANE_SIZE = 4618;
const TOWER_TOP_M = 5500;
/**
 * Rotate the tiles 180° about the vertical so the scene matches the compass and the
 * rest of the app (+X = east, -Z = north). Without it the tiles come in with
 * +X = west, +Z = north.
 */
const TILE_AZIMUTH = Math.PI;
const GROUND_CACHE_PREFIX = "jumpersim.groundEllipsoidM.";

/**
 * Owns everything map-related in the scene: streamed terrain + imagery, 3D buildings,
 * the ground heightfield, grid, height axis, fog and map lighting. One instance lives
 * for the whole session; `load(dz)` swaps the dropzone and cleans up the previous one.
 *
 * Coordinate frame: three.js +Y up, metres, origin at the DZ, and the DZ ground at y = 0.
 */
export class MapScene {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private renderer: THREE.WebGLRenderer;
  options: MapOptions;

  private terrain: TilesRenderer | null = null;
  private buildings: TilesRenderer | null = null;
  private terrainReorient: ReorientationPlugin | null = null;
  private buildingsReorient: ReorientationPlugin | null = null;
  private overlayPlugin: ImageOverlayPlugin | null = null;
  private currentOverlay: any = null;
  private retiringOverlays: any[] = [];
  private buildingMaterials = new Set<THREE.MeshLambertMaterial>();

  private heightField = new GroundHeightField(
    MAP_DEFAULTS.coverageRadiusM,
    MAP_DEFAULTS.heightFieldSpacingM,
  );
  private rebuildTimer: number | null = null;

  private grid: THREE.GridHelper | null = null;
  private heightAxis: HeightAxis | null = null;
  private windTower: WindTower | null = null;
  private fallbackPlane: THREE.Mesh | null = null;
  private hemiLight: THREE.HemisphereLight;
  private attributionEl: HTMLElement;

  private loadId = 0;
  private latRad = 0;
  private lonRad = 0;
  /** Ellipsoid height (m) of the DZ ground, i.e. the world y = 0 plane. */
  groundEllipsoidM = 0;
  usingFallback = false;

  private lastExternalUpdate = -Infinity;
  private rafId = 0;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    options: Partial<MapOptions> = {},
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.options = {
      imagery: MAP_DEFAULTS.imagery,
      buildings: MAP_DEFAULTS.buildings,
      showGrid: MAP_DEFAULTS.showGrid,
      showWind: MAP_DEFAULTS.showWind,
      ...options,
    };
    if (!isImageryAvailable(this.options.imagery)) {
      this.options.imagery = "cesium";
    }

    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x222222, 0.6);

    this.attributionEl = document.createElement("div");
    this.attributionEl.id = "map-attribution";
    document.body.appendChild(this.attributionEl);

    // Tiles must keep streaming before the sim's render loop starts (the sim waits
    // for the map to be ready), so run our own update loop until it takes over.
    const tick = () => {
      if (performance.now() - this.lastExternalUpdate > 100) this.tick();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Load the map for a dropzone. Resolves once the ground is calibrated and the
   * heightfield is built (or the fallback is in place, or the timeout passes).
   */
  async load(
    dz: DropzoneLike,
    onProgress: (fraction: number) => void = () => {},
  ): Promise<void> {
    const id = ++this.loadId;
    onProgress(0.05);
    this.unload();

    this.latRad = THREE.MathUtils.degToRad(dz.latitude);
    this.lonRad = THREE.MathUtils.degToRad(dz.longitude);

    this.addHelpers();

    if (!CESIUM_ION_TOKEN) {
      console.warn(
        "Cesium Ion token not set (VITE_CESIUM_ION_TOKEN). Using wireframe map.",
      );
      this.useFallback();
      return;
    }

    const cacheKey = `${GROUND_CACHE_PREFIX}${dz.latitude.toFixed(5)},${dz.longitude.toFixed(5)}`;
    const cached = Number(safeGet(cacheKey));
    const haveCache = Number.isFinite(cached) && safeGet(cacheKey) !== null;
    this.groundEllipsoidM = haveCache ? cached : 0;

    // don't drape Mapbox tiles that Mapbox is going to refuse
    if (this.options.imagery === "mapbox-dark" && !(await checkMapboxAccess())) {
      this.fallBackToCesiumImagery();
    }
    if (id !== this.loadId) return;

    let rootFailed = false;
    try {
      this.createTerrain();
      if (this.options.buildings) this.createBuildings();
    } catch (err) {
      console.error("Terrain init failed. Falling back to wireframe.", err);
      this.useFallback();
      return;
    }
    this.terrain!.addEventListener("load-error", (e: any) => {
      if (e.tile === null) rootFailed = true;
    });

    // keep the map hidden until the ground is at y = 0, unless we already know it
    this.terrain!.group.visible = haveCache;
    if (this.buildings) this.buildings.group.visible = haveCache;

    const outcome = await this.waitForSettle(
      this.terrain!,
      () => rootFailed,
      MAP_DEFAULTS.terrainReadyTimeoutMs,
      // tiles streaming in covers most of the bar; calibration is the last bit
      (f) => onProgress(0.1 + 0.8 * f),
    );
    if (id !== this.loadId) return; // a newer dropzone was selected meanwhile

    if (outcome === "failed") {
      console.error("Cesium terrain failed to load. Falling back to wireframe.");
      this.unloadTiles();
      this.useFallback();
      return;
    }

    onProgress(0.92);
    this.calibrateGround();
    if (Number.isFinite(this.groundEllipsoidM)) {
      safeSet(cacheKey, this.groundEllipsoidM.toFixed(2));
    }

    this.terrain!.group.visible = true;
    if (this.buildings) this.buildings.group.visible = true;
    setGroundProvider((x, z) => this.heightField.getHeight(x, z));

    // refine the heightfield quietly as finer tiles stream in
    this.terrain!.addEventListener("tiles-load-end", () =>
      this.scheduleHeightRebuild(),
    );

    onProgress(1);
    console.info(
      `Map ready for ${dz.name}: ground ellipsoid height ${this.groundEllipsoidM.toFixed(1)} m` +
        (outcome === "timeout" ? " (timed out waiting for full detail)" : ""),
    );
  }

  /** Call once per frame from the main render loop. */
  update() {
    this.lastExternalUpdate = performance.now();
    this.tick();
  }

  private tick() {
    if (!this.terrain && !this.buildings) return;
    this.camera.updateMatrixWorld();
    this.terrain?.update();
    if (this.buildings && this.options.buildings) this.buildings.update();
  }

  onResize() {
    this.terrain?.setResolutionFromRenderer(this.camera, this.renderer);
    this.buildings?.setResolutionFromRenderer(this.camera, this.renderer);
  }

  /** Object to raycast against for clicks on the ground (jumprun alignment). */
  getRaycastTarget(): THREE.Object3D | null {
    if (this.terrain && this.terrain.group.visible) return this.terrain.group;
    return this.fallbackPlane ?? this.grid;
  }

  dispose() {
    this.unload();
    cancelAnimationFrame(this.rafId);
    this.attributionEl.remove();
  }

  // ---------------------------------------------------------------- options

  /** Swap the imagery draped on the terrain without reloading anything else. */
  async setImagery(key: ImageryKey): Promise<boolean> {
    if (!isImageryAvailable(key)) return false;
    if (key === this.options.imagery) return true;
    if (key === "mapbox-dark" && !(await checkMapboxAccess())) {
      this.fallBackToCesiumImagery();
      return false;
    }
    this.options.imagery = key;
    this.applyTheme();

    if (!this.overlayPlugin) return true;
    const next = createImageryOverlay(key);
    // new overlay is drawn on top; drop the old one once the new tiles have had time
    // to arrive so the ground never flashes untextured
    this.overlayPlugin.addOverlay(next);
    if (this.currentOverlay) this.retiringOverlays.push(this.currentOverlay);
    this.currentOverlay = next;
    const plugin = this.overlayPlugin;
    window.setTimeout(() => {
      if (plugin !== this.overlayPlugin) return;
      this.retiringOverlays.forEach((o) => plugin.deleteOverlay(o));
      this.retiringOverlays = [];
    }, 3000);
    return true;
  }

  private mapboxWarningShown = false;

  /** Mapbox refused the token: use Cesium imagery and tell the user once. */
  private fallBackToCesiumImagery() {
    this.options.imagery = "cesium";
    this.applyTheme();
    window.dispatchEvent(
      new CustomEvent("map-imagery-unavailable", { detail: "mapbox-dark" }),
    );
    if (!this.mapboxWarningShown) {
      this.mapboxWarningShown = true;
      notificationManager.warning(
        "Mapbox refused the Dark map tiles, so the map is showing Cesium satellite. " +
          "Check the Mapbox token's URL restrictions.",
        { duration: 10000 },
      );
    }
  }

  setBuildingsEnabled(enabled: boolean) {
    this.options.buildings = enabled;
    if (enabled && !this.buildings && this.terrain && CESIUM_ION_TOKEN) {
      this.createBuildings();
      if (this.terrain.group.visible) this.applyGroundHeight(this.buildingsReorient!, this.buildings!);
    }
    if (this.buildings) this.buildings.group.visible = enabled;
  }

  setWindVisible(visible: boolean) {
    this.options.showWind = visible;
    this.windTower?.setVisible(visible);
  }

  setGridVisible(visible: boolean) {
    this.options.showGrid = visible;
    if (this.grid) this.grid.visible = visible || this.usingFallback;
  }

  // ---------------------------------------------------------------- internals

  private createTerrain() {
    const tiles = new TilesRenderer();
    const reorient = new ReorientationPlugin({
      up: "+y",
      recenter: true,
      lat: this.latRad,
      lon: this.lonRad,
      height: this.groundEllipsoidM,
      azimuth: TILE_AZIMUTH,
    });
    tiles.registerPlugin(reorient);
    tiles.registerPlugin(
      new CesiumIonAuthPlugin({
        apiToken: CESIUM_ION_TOKEN,
        assetId: ION_ASSETS.worldTerrain,
        autoRefreshToken: true,
        assetTypeHandler: (assetType: string, terrainTiles: any) => {
          if (assetType === "TERRAIN") {
            terrainTiles.registerPlugin(new QuantizedMeshPlugin({}));
          }
        },
      }),
    );
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new UpdateOnChangePlugin());

    this.currentOverlay = createImageryOverlay(this.options.imagery);
    this.overlayPlugin = new ImageOverlayPlugin({
      overlays: [this.currentOverlay],
      renderer: this.renderer,
    });
    tiles.registerPlugin(this.overlayPlugin);
    tiles.registerPlugin(
      this.makeRegionPlugin(tiles, MAP_DEFAULTS.coverageRadiusM, MAP_DEFAULTS.regionErrorTarget),
    );

    tiles.addEventListener("load-error", (event: any) => {
      console.error("Terrain tile load error:", event.error, event.url);
    });

    tiles.setCamera(this.camera);
    tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.scene.add(tiles.group);
    this.terrain = tiles;
    this.terrainReorient = reorient;
  }

  private createBuildings() {
    const tiles = new TilesRenderer();
    const reorient = new ReorientationPlugin({
      up: "+y",
      recenter: true,
      lat: this.latRad,
      lon: this.lonRad,
      height: this.groundEllipsoidM,
      azimuth: TILE_AZIMUTH,
    });
    tiles.registerPlugin(reorient);
    tiles.registerPlugin(
      new CesiumIonAuthPlugin({
        apiToken: CESIUM_ION_TOKEN,
        assetId: ION_ASSETS.osmBuildings,
        autoRefreshToken: true,
      }),
    );
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new UpdateOnChangePlugin());
    tiles.registerPlugin(
      this.makeRegionPlugin(tiles, MAP_DEFAULTS.buildingsRadiusM, 10),
    );

    tiles.addEventListener("load-model", ({ scene }: any) => {
      scene.traverse((obj: THREE.Object3D) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = new THREE.MeshLambertMaterial({
          color: THEME[this.options.imagery].building,
        });
        this.buildingMaterials.add(mat);
        mesh.material = mat; // originals are disposed by the renderer on unload
      });
    });
    tiles.addEventListener("dispose-model", ({ scene }: any) => {
      scene.traverse((obj: THREE.Object3D) => {
        const mat = (obj as THREE.Mesh).material as THREE.MeshLambertMaterial;
        if (mat && this.buildingMaterials.has(mat)) {
          this.buildingMaterials.delete(mat);
          mat.dispose();
        }
      });
    });
    tiles.addEventListener("load-error", (event: any) => {
      console.error("Buildings tile load error:", event.error, event.url);
    });

    tiles.setCamera(this.camera);
    tiles.setResolutionFromRenderer(this.camera, this.renderer);
    tiles.group.visible = this.terrain?.group.visible ?? false;
    this.scene.add(tiles.group);
    this.buildings = tiles;
    this.buildingsReorient = reorient;
  }

  /** Keep a sphere around the DZ loaded at high detail regardless of camera view. */
  private makeRegionPlugin(tiles: TilesRenderer, radius: number, errorTarget: number) {
    // regions live in the tileset's own (Earth-centred) frame, not the scene frame
    const center = new THREE.Vector3();
    (tiles as any).ellipsoid.getCartographicToPosition(
      this.latRad,
      this.lonRad,
      this.groundEllipsoidM,
      center,
    );
    const plugin = new LoadRegionPlugin();
    plugin.addRegion(
      new SphereRegion({
        sphere: new THREE.Sphere(center, radius),
        errorTarget,
      }),
    );
    return plugin;
  }

  /**
   * Wait until the root has loaded and the download/parse queues stay empty for a
   * moment, meaning the coverage region has finished refining.
   */
  private waitForSettle(
    tiles: TilesRenderer,
    failed: () => boolean,
    timeoutMs: number,
    onProgress: (fraction: number) => void = () => {},
  ): Promise<"settled" | "timeout" | "failed"> {
    return new Promise((resolve) => {
      const start = performance.now();
      let quietPolls = 0;
      const poll = () => {
        if (this.terrain !== tiles) return resolve("failed");
        if (failed()) return resolve("failed");
        const s: any = (tiles as any).stats;
        const busy = s.queued + s.downloading + s.parsing;
        let models = 0;
        tiles.forEachLoadedModel(() => models++);
        if ((tiles as any).root) {
          // share of known tiles that have finished loading
          onProgress(s.loaded / Math.max(1, s.loaded + busy));
        }
        quietPolls = (tiles as any).root && busy === 0 && models > 0 ? quietPolls + 1 : 0;
        if (quietPolls >= 3) return resolve("settled");
        if (performance.now() - start > timeoutMs) {
          return resolve(models > 0 ? "timeout" : "failed");
        }
        window.setTimeout(poll, 250);
      };
      poll();
    });
  }

  /** Measure the terrain under the DZ and shift both tilesets so it sits at y = 0. */
  private calibrateGround() {
    const terrain = this.terrain!;
    terrain.group.updateMatrixWorld(true);
    this.heightField.build((cb) => terrain.forEachLoadedModel(cb));
    const h0 = this.heightField.getHeight(0, 0);
    if (!Number.isFinite(h0)) {
      console.warn("Could not sample ground height at the DZ; leaving terrain as is.");
      return;
    }
    this.groundEllipsoidM += h0;
    this.applyGroundHeight(this.terrainReorient!, terrain);
    if (this.buildings) this.applyGroundHeight(this.buildingsReorient!, this.buildings);
    this.heightField.offset(-h0);
  }

  private applyGroundHeight(reorient: ReorientationPlugin, tiles: TilesRenderer) {
    // also update the stored height in case the root tileset hasn't loaded yet
    (reorient as any).height = this.groundEllipsoidM;
    if ((tiles as any).root) {
      reorient.transformLatLonHeightToOrigin(
        this.latRad,
        this.lonRad,
        this.groundEllipsoidM,
        TILE_AZIMUTH,
      );
    }
  }

  private scheduleHeightRebuild() {
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      const terrain = this.terrain;
      if (!terrain) return;
      terrain.group.updateMatrixWorld(true);
      this.heightField.build((cb) => terrain.forEachLoadedModel(cb));
    }, 1500);
  }

  private addHelpers() {
    this.grid = new THREE.GridHelper(PLANE_SIZE, 16);
    this.grid.visible = this.options.showGrid;
    (window as any).gridHelper = this.grid;
    this.scene.add(this.grid);

    this.heightAxis = new HeightAxis({
      maxHeight: 5500, // ~18000 ft in meters
      minHeight: 0,
      majorInterval: 304.8, // ~1000 ft in meters
    });
    (window as any).heightAxis = this.heightAxis;
    this.scene.add(this.heightAxis.getObject());

    // wind arrows on the tower (x = the tower's position at the grid edge)
    this.windTower = new WindTower(PLANE_SIZE / 2, TOWER_TOP_M);
    this.windTower.setVisible(this.options.showWind);
    this.heightAxis.getObject().add(this.windTower.object);

    this.scene.add(this.hemiLight);
    this.scene.fog = new THREE.Fog(THEME[this.options.imagery].fog, 15000, 60000);
    this.applyTheme();
  }

  private applyTheme() {
    const theme = THEME[this.options.imagery];
    this.buildingMaterials.forEach((m) => m.color.setHex(theme.building));
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color.setHex(theme.fog);
    const credits = [IMAGERY_ATTRIBUTION[this.options.imagery]];
    if (this.options.buildings) credits.push("Buildings © OpenStreetMap contributors");
    credits.push("Terrain © Cesium");
    this.attributionEl.textContent = this.usingFallback ? "" : credits.join(" · ");
  }

  private useFallback() {
    this.usingFallback = true;
    const geometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
    const material = new THREE.MeshBasicMaterial({ wireframe: true });
    this.fallbackPlane = new THREE.Mesh(geometry, material);
    this.fallbackPlane.rotation.x = -Math.PI / 2;
    (window as any).mapPlane = this.fallbackPlane;
    this.scene.add(this.fallbackPlane);
    if (this.grid) this.grid.visible = true;
    setGroundProvider(null);
    this.applyTheme();
  }

  private unloadTiles() {
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = null;
    for (const tiles of [this.terrain, this.buildings]) {
      if (!tiles) continue;
      this.scene.remove(tiles.group);
      tiles.dispose();
    }
    this.buildingMaterials.forEach((m) => m.dispose());
    this.buildingMaterials.clear();
    this.terrain = null;
    this.buildings = null;
    this.terrainReorient = null;
    this.buildingsReorient = null;
    this.overlayPlugin = null;
    this.currentOverlay = null;
    this.retiringOverlays = [];
    this.heightField.clear();
    setGroundProvider(null);
  }

  private unload() {
    this.unloadTiles();
    this.windTower?.dispose();
    this.windTower = null;
    for (const obj of [this.grid, this.heightAxis?.getObject(), this.fallbackPlane]) {
      if (!obj) continue;
      this.scene.remove(obj);
      disposeObject(obj);
    }
    this.scene.remove(this.hemiLight);
    this.scene.fog = null;
    this.grid = null;
    this.heightAxis = null;
    this.fallbackPlane = null;
    this.usingFallback = false;
    delete (window as any).mapPlane;
    delete (window as any).gridHelper;
    delete (window as any).heightAxis;
  }
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((obj: any) => {
    obj.geometry?.dispose?.();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((m: any) => {
      m?.map?.dispose?.();
      m?.dispose?.();
    });
  });
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable; calibration just reruns next time */
  }
}
