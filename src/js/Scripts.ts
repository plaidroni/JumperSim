import { JUMPER_UNITS_TO_M, WORLD_SCALE, sceneToWorld, worldRoot } from "./core/WorldScale";
import { initializeMarkers, markerObjects, updateMarkers } from "./visuals/Markers";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { clampVectorAboveYZero } from "./Utils";
import { GlobalWindVars } from "./GlobalVars";
import { Plane, Jumper } from "./classes/BaseEntities";
import {
  createDefaultSimJumpers,
  SimJumper,
  SimPlane,
} from "./classes/SimEntities";
import { loadDropzones } from "./LocationSelect";
import { initializePlaneManager, loadPlaneModel } from "./PlaneSelect";
import { Fleet } from "./fleet/Fleet";
import { scheduleExits } from "./fleet/ExitSchedule";
import { AIRCRAFT } from "./fleet/Aircraft";
import {
  createDynamicTrajectoryLine,
  updateTrajectoryLines,
  visualizeJumpers,
} from "./ui/TrajectoryLines";
import { setLoadReplacer } from "./core/data/LoadStore";
import { addTooltipToggle } from "./Menubar";
import { initializeDock } from "./editor/Dock";
import { initializeTimeline, renderTimelineMarkers } from "./editor/Timeline";
import { initializeSceneObjects } from "./panels/SceneObjects";
import { initializeWindWidget } from "./panels/WindWidget";
import { initializeWeatherPanel } from "./panels/WeatherPanel";
import { initializeWeatherMenu } from "./ui/WeatherMenu";
import { initializeCameraZoop } from "./ui/CameraZoop";
// Notification system for displaying alerts and feedback to users
// Usage: notificationManager.success/error/warning/info(message, options)
import { notificationManager } from "./classes/NotificationManager";
import { alignPlaneToJumprun } from "./utils/AlignJumprun";
import {
  askForRefresh,
  notifyRecalculated,
  setRecalculationHandler,
} from "./core/data/SimulationVariables";
import { StartEditPlane } from "./ui/PlaneEdit";
import { renderPlaneLoad } from "./ui/PlaneSettings";
import { PlaneLoad } from "./ui/PlaneLoad";
import { SIM_DURATION_S, updateSimWindow } from "./physics/SimWindow";
import { updateCanopyRigs } from "./visuals/CanopyRig";
import { precalculateJumpers } from "./classes/SimEntities";
import { getDropzonePlan, planReferencePoint } from "./dropzone/DropzonePlan";
import { enToXZ } from "./dropzone/geometry";
import { applyJumprun } from "./dropzone/Jumprun";
import { currentWindProfile } from "./wind/WindProfile";
import {
  CameraFollow,
  FOLLOW_MODES,
  FollowMode,
  PickMenuItem,
  closePickMenu,
  isPickMenuOpen,
  showPickMenu,
} from "./ui/CameraFollow";
import { initializePlanner, type Planner } from "./dropzone/PlannerView";
import { applyJumpSettingsToPlane, exitAltitudeM, getJumpSettings } from "./core/data/JumpSettings";
import { initializeJumpSettingsPanel } from "./ui/JumpSettingsPanel";
import { initializeFileMenu } from "./ui/FileMenu";
import { initializePlanSourceBanner } from "./ui/PlanSourceBanner";
import { adjustmentText, initializeAdjustmentArrowsToggle, updateAdjustmentArrows } from "./visuals/AdjustmentArrows";
import { WeatherRenderer } from "./visuals/weather/WeatherRenderer";
import { registerOverlay, seeAllLayers, unregisterOverlay } from "./visuals/Layers";

// === THREE SETUP ===
const scene = new THREE.Scene();
// everything positioned in metres (map, plane, jumpers, lines, overlays) lives under
// worldRoot, drawn WORLD_SCALE× larger (specs/world-scale.md)
scene.add(worldRoot);
// the scaled world spans ~50 km of scene units: a log depth buffer keeps near terrain
// and far terrain free of z-fighting
const renderer = new THREE.WebGLRenderer({ logarithmicDepthBuffer: true });
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.5, // was 0.1; a larger near plane avoids z-fighting on distant terrain
  100000 * WORLD_SCALE,
);
const controls = new OrbitControls(camera, renderer.domElement);
(window as any).simulationControls = controls;
// clouds, haze and rain darkening (specs/weather-clouds-visibility.md §5.1)
seeAllLayers(camera);
const weatherRenderer = new WeatherRenderer(renderer);
(window as any).weatherRenderer = weatherRenderer;

(window as any).simulationCamera = camera;
(window as any).simulationRenderer = renderer;
(window as any).simulationControls = controls;

// The 3D view fills #viewport (the editor layout sizes it), not the whole window
const viewportEl = document.getElementById("viewport") ?? document.body;
viewportEl.appendChild(renderer.domElement);
function resizeToViewport() {
  const width = Math.max(1, viewportEl.clientWidth);
  const height = Math.max(1, viewportEl.clientHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  weatherRenderer.setSize();
  (window as any).mapScene?.onResize();
}
resizeToViewport();
let resizeQueued = false;
new ResizeObserver(() => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    resizeToViewport();
  });
}).observe(viewportEl);

// === SKY BACKGROUND + CLOUDS ===
function createBackgroundTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, "#040404");
  gradient.addColorStop(0.5, "#0a0a0a");
  gradient.addColorStop(1, "#111111");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const backgroundTexture = createBackgroundTexture();
scene.background = backgroundTexture;
renderer.setClearColor(0x000000, 1);

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(10, 10, 10);
seeAllLayers(light);
scene.add(light);
weatherRenderer.setSun(light); // clouds are lit (and cast shadows) from the scene's light
// visibility ring / planner clouds centre: the orbit target in 3D, the landing area in the planner
weatherRenderer.setFocus({
  view: () => controls.target.clone().divideScalar(WORLD_SCALE),
  planner: () => {
    const t = enToXZ(planReferencePoint(getDropzonePlan()));
    return new THREE.Vector3(t.x, 0, t.z);
  },
});
const ambient = new THREE.AmbientLight(0xffffff, 0.3);
seeAllLayers(ambient);
scene.add(ambient);
scene.add(new THREE.AxesHelper(5));

let clock = new THREE.Clock();

camera.position.set(0, 108 * WORLD_SCALE, 30 * WORLD_SCALE);
controls.update();

// === TOOLTIP ===
const tooltip = {
  element: document.getElementById("info-tooltip"),
  show: true,
};
addTooltipToggle(tooltip);

const compass = document.getElementById("compass");
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
seeAllLayers(raycaster); // markers live on the overlay layer

// const gridHelper = new THREE.GridHelper(1609, 16); // 16 subdivisions = 100m spacing
// scene.add(gridHelper);

// === LOOKING AT SCENE OBJECT ===
let isEditingPlane = false;
// === EVENT LISTENERS ===

let isAligningJumprun: Boolean = false;
let planner: Planner | null = null;
let alignPoints: THREE.Vector3[] = [];
let alignArrow: THREE.ArrowHelper | null = null;

// A click (press + release without dragging) on the plane or a jumper selects and
// follows it. Raycast at click time; the old "flag for the next frame" approach missed
// clicks whenever a frame didn't land within 1 ms.
let pressAt: { x: number; y: number } | null = null;
renderer.domElement.addEventListener("pointerdown", (e) => {
  pressAt = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
});
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!pressAt || e.button !== 0) return;
  const moved = Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y);
  pressAt = null;
  if (moved > 4 || isEditingPlane || isAligningJumprun || planner?.active) return;
  onMouseMove(e);
  const hadMenu = isPickMenuOpen();
  const picked = pickAt([...planeMeshes(), ...simJumpers.map((j) => j.getMesh()), ...markerObjects()]);
  if (picked) showFollowMenu(picked, { x: e.clientX, y: e.clientY });
  else if (!hadMenu) closePickMenu();
});

function onMouseMove(event) {
  // picking coordinates relative to the canvas (the docks take part of the window)
  const r = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - r.left) / r.width) * 2 - 1;
  mouse.y = -((event.clientY - r.top) / r.height) * 2 + 1;

  if (tooltip) {
    // (tooltip.element as HTMLElement).style.left = `${event.clientX + 10}px`;
    // (tooltip.element as HTMLElement).style.top = `${event.clientY + 10}px`;
    (tooltip.element as HTMLElement).style.transform = `translate(${
      event.clientX + 10
    }px, ${event.clientY + 10}px)`;
  }
}

document.addEventListener("mousemove", onMouseMove);

// group formations first, then others.

// we should refactor this later to include proper load order:
// First to board: High pullers/Canopy Relative Work
// Wingsuits
// Tracking dives 2
// Tandems
// Skydiver Training Program Students
// Freefly groups, smallest to largest.
// Belly-fly groups, smallest to largest.
// Tracking/tracing/horizontal dives (Tracking and other horizontal skydives are approved and placed in the loading order on a case-by-case basis after approval from one of our S&TAs, load organizers, or drop zone manager.)
// Last to board, first to exit: Any lower-altitude individuals or groups.
// Ensure formation jumpers are grouped together and indices are sequential
function groupAndReindexJumpers(
  plane: SimPlane,
  all: SimJumper[],
): SimJumper[] {
  // Helper to get the load-order group, fallback to 'belly'
  // (sit fly and head down board as freefly groups)
  function getStyle(j: SimJumper): string {
    const style = (j as any).flyingStyle || "belly";
    return style === "sitfly" || style === "headdown" ? "freefly" : style;
  }

  // Helper to assign random style if missing
  function ensureStyle(j: SimJumper) {
    if (!(j as any).flyingStyle) (j as any).flyingStyle = "belly";
  }

  // Formation jumpers first, in formation order
  const formations = plane.formations || [];
  const formationJumpers: SimJumper[] = [];
  const formationSet = new Set<string>();
  formations.forEach((f: any) => {
    const group = (f?.getAllJumpers?.() || []) as SimJumper[];
    group.forEach((j) => {
      ensureStyle(j);
      formationJumpers.push(j);
      formationSet.add(j.id);
    });
  });

  // Non-formation jumpers
  const others = all.filter((j) => !formationSet.has(j.id));
  others.forEach(ensureStyle);

  // Grouping logic for non-formation jumpers
  // Map of style to jumpers
  const styleGroups: Record<string, SimJumper[]> = {};
  for (const j of others) {
    const style = getStyle(j);
    if (!styleGroups[style]) styleGroups[style] = [];
    styleGroups[style].push(j);
  }

  // Helper to sort by group size (ascending)
  function byGroupSizeAsc(a: SimJumper[], b: SimJumper[]) {
    return a.length - b.length;
  }

  // Order per comment
  const ordered: SimJumper[] = [
    ...formationJumpers,
    ...(styleGroups["crw"] || []), // High pullers/CRW
    ...(styleGroups["wingsuit"] || []), // Wingsuits
    ...(styleGroups["tracking2"] || []), // Tracking dives 2
    ...(styleGroups["tandem"] || []), // Tandems
    ...(styleGroups["student"] || []), // Students
    // Freefly groups, smallest to largest
    ...(styleGroups["freefly"] ? [styleGroups["freefly"]] : [])
      .sort(byGroupSizeAsc)
      .flat(),
    // Belly-fly groups, smallest to largest
    ...(styleGroups["belly"] ? [styleGroups["belly"]] : [])
      .sort(byGroupSizeAsc)
      .flat(),
    ...(styleGroups["tracking"] || []), // Tracking/tracing/horizontal
    ...(styleGroups["low-altitude"] || []), // Lower-altitude
  ];

  // Add any remaining styles not explicitly listed
  const usedStyles = new Set([
    "crw",
    "wingsuit",
    "tracking2",
    "tandem",
    "student",
    "freefly",
    "belly",
    "tracking",
    "low-altitude",
  ]);
  Object.entries(styleGroups).forEach(([style, group]) => {
    if (!usedStyles.has(style)) ordered.push(...group);
  });

  // Assign contiguous indices
  ordered.forEach((j, i) => {
    j.index = i;
  });

  return ordered;
}

function collectTwoAlignPoints(
  mapPlane: THREE.Object3D,
): Promise<[THREE.Vector3, THREE.Vector3]> {
  console.log("Listening for clicks");
  return new Promise((resolve) => {
    let points: THREE.Vector3[] = [];

    function onClick(event: MouseEvent) {
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(mapPlane, true);
      if (intersects.length > 0) {
        points.push(sceneToWorld(intersects[0].point)); // scene units → metres
        if (points.length === 2) {
          renderer.domElement.removeEventListener("click", onClick);
          resolve([points[0], points[1]]);
          console.log("Collected points:", points);
        }
      }
    }

    renderer.domElement.addEventListener("click", onClick);
  });
}

async function handleStartAlignJumprun() {
  // the jumprun is set in the Dropzone Planner now
  if (planner) {
    planner.enter("jumprun");
    return;
  }
  // the two points where we will find the angle between
  // init
  console.log("Starting jumprun alignment...");
  alignPoints = [];

  if (alignArrow) {
    scene.remove(alignArrow);
    alignArrow = null;
  }

  isAligningJumprun = true;

  const mapPlane =
    (window as any).mapScene?.getRaycastTarget() ??
    (window as any).mapPlane ??
    (window as any).gridHelper;

  notificationManager.info(
    "Click two points on the map to set jumprun direction.",
  );
  const [p1, p2] = await collectTwoAlignPoints(mapPlane);
  alignPoints = [p1, p2];
  drawAlignArrow();
  isAligningJumprun = false;
  alignPlaneToJumprun(simPlane, p1, p2);
  askForRefresh(() => recalculateSimulation(), true);
}

function drawAlignArrow() {
  // the jumprun is drawn by the plan overlays (dropzone/PlanOverlays.ts) now
  return;
  if (alignArrow) {
    scene.remove(alignArrow);
    alignArrow = null;
  }

  const [p1, p2] = alignPoints;
  const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
  const length = p1.distanceTo(p2);
  alignArrow = new THREE.ArrowHelper(dir, p1, length, 0xff0000, length * 0.1);

  worldRoot.add(alignArrow);
}

document
  .getElementById("start-align-jumprun")
  ?.addEventListener("click", handleStartAlignJumprun);

type Picked = { type: "plane" | "jumper"; id: string; root: THREE.Object3D; name: string };

/** Select the plane/jumper under the mouse, if any, and return it. */
function pickAt(objects: Array<THREE.Object3D | null>): Picked | null {
  raycaster.setFromCamera(mouse, camera);
  const valid = objects.filter((o): o is THREE.Object3D => o != null);
  if (valid.length === 0) return null;
  const hit = raycaster.intersectObjects(valid, true)[0];
  if (!hit) return null;
  const picked = findSceneObjectFor(hit.object);
  if (!picked) return null;
  const jumper = picked.type === "jumper" ? currentJumpers().find((j) => j.id === picked.id) : null;
  const plane = picked.type === "plane" ? fleet.planes.find((p) => p.id === picked.id) : null;
  const root = plane ? plane.getMesh() : jumper?.getMesh() ?? hit.object;
  if (!root) return null;
  window.dispatchEvent(new CustomEvent("scene-object-picked", { detail: picked }));
  return { ...picked, root, name: plane ? planeLabel(plane) : jumperLabel(jumper) };
}

function planeMeshes(): THREE.Object3D[] {
  return fleet.planes.map((p) => p.getMesh()).filter((m): m is THREE.Object3D => !!m);
}

function planeLabel(p: SimPlane) {
  return fleet.planes.length > 1 ? `${p.label || "the plane"} (${AIRCRAFT[p.aircraftId].name})` : "the plane";
}

function currentJumpers(): SimJumper[] {
  return Array.isArray((window as any).simJumpers) ? (window as any).simJumpers : simJumpers;
}

function jumperLabel(j: SimJumper | null | undefined) {
  return (j as any)?.name || `Jumper ${(j?.index ?? 0) + 1}`;
}

/** Click menu on a plane/jumper: follow options, details, stop following. */
function showFollowMenu(p: Picked, at: { x: number; y: number }) {
  const following = cameraFollow.isFollowing(p.root);
  const keys: Record<FollowMode, string> = { free: "F", close: "C", chase: "R", top: "T" };
  const items: Array<PickMenuItem | "sep"> = FOLLOW_MODES.map((m) => ({
    label: m.label,
    hint: m.hint,
    key: keys[m.mode],
    active: following && cameraFollow.mode === m.mode,
    action: () => cameraFollow.follow(p.root, { mode: m.mode, name: p.name }),
  }));
  items.push("sep", {
    label: "Show details",
    hint: "Open it in Scene Objects",
    key: "D",
    action: () => (window as any).dock?.focus?.("objects"),
  });
  if (cameraFollow.isFollowing()) {
    items.push({ label: "Stop following", hint: "Esc also stops following", danger: true, action: () => cameraFollow.stop() });
  }
  const title = p.type === "plane" ? "Plane" : p.name;
  showPickMenu(viewportEl as HTMLElement, at, following ? `${title} · following` : title, items);
}

function checkHoverIntersect(objects: Array<THREE.Object3D | null>) {
  if (
    !objects ||
    objects.length === 0 ||
    !camera ||
    !raycaster ||
    isEditingPlane
  )
    return;
  raycaster.setFromCamera(mouse, camera);
  const validObjects = objects.filter((obj) => obj != null);
  if (validObjects.length === 0) return;

  try {
    const intersects = raycaster.intersectObjects(validObjects, true);

    if (intersects.length > 0) {
      const obj = intersects[0].object;
      const id = obj.id;
      const data = obj.userData;

      // we check if the object we're following is a plane, if so we put the user into edit mode

      if (data?.label && tooltip.element && tooltip.show) {
        let html = `<strong>${data.label}</strong><br>`;
        for (const key in data)
          if (key !== "label") html += `${key}: ${data[key]}<br>`;
        (tooltip.element as HTMLElement).innerHTML = html;
        (tooltip.element as HTMLElement).style.display = "block";
      }

      return;
    }

    if (tooltip) (tooltip.element as HTMLElement).style.display = "none";
  } catch (err) {
    console.warn("Raycast error:", err);
    if (tooltip) (tooltip.element as HTMLElement).style.display = "none";
  }
}

// === PLANE +JUMPER + SIMULATION ===
const stlLoader = new STLLoader();
const simPlane = new SimPlane(
  new THREE.Vector3(0, exitAltitudeM(), 0),
  getJumpSettings().planeSpeedKt,
  new THREE.Vector3(90, 0, 0),
);
// === FLEET (specs/formation-jumps.md §5) ===
simPlane.aircraftId = "twin-otter";
simPlane.label = "Lead";
simPlane.planeColor = AIRCRAFT["twin-otter"].color;
const fleet = new Fleet(simPlane);
fleet.modelLoader = (p) => void loadPlaneModel(p);
(<any>window).fleet = fleet;
Object.defineProperty(window, "simPlanes", { get: () => fleet.planes, configurable: true });
loadPlaneModel(simPlane);
// === SIMULATION DATA ===

let simJumpers: SimJumper[] = [];
(<any>window).simPlane = simPlane;
(<any>window).simJumpers = simJumpers;
// attach PlaneLoad instance to plane for centralized state
(simPlane as any).planeLoad = new PlaneLoad(simPlane);

// Start with 10 default jumpers. Formations come from Import .jump (specs/formation-jumps.md §4).
simJumpers = groupAndReindexJumpers(simPlane, createDefaultSimJumpers(10, simPlane));
(<any>window).simJumpers = simJumpers;
simPlane.jumpers = simJumpers;
(simPlane as any).planeLoad?.render();

// === JUMPER MESHES, TRAJECTORY LINES AND LOAD REPLACEMENT ===
let jumperGeometry: THREE.BufferGeometry | null = null;
let lines: THREE.Line[] = [];
let sceneReady = false;

/** Give a jumper its wireframe skydiver mesh, in its own colour (or a random one). */
function attachJumperMesh(jumper: SimJumper) {
  if (!jumperGeometry) return;
  const hex = (jumper as any).color as string | undefined;
  const color = hex ? new THREE.Color(hex) : new THREE.Color(Math.random(), Math.random(), Math.random());
  const material = new THREE.MeshBasicMaterial({ color, wireframe: true });
  const mesh = new THREE.Mesh(jumperGeometry, material);
  mesh.scale.setScalar(JUMPER_UNITS_TO_M); // true size in the scaled world (10.4 model units = 1.8 m)
  const old = jumper.getMesh();
  if (old) old.removeFromParent();
  jumper.setMesh(mesh);
  worldRoot.add(mesh);
}

/** Rebuild one trajectory line per jumper. */
function rebuildTrajectoryLines() {
  lines.forEach((l) => {
    l.removeFromParent();
    l.geometry?.dispose();
  });
  unregisterOverlay(...lines);
  lines = simJumpers.map(createDynamicTrajectoryLine);
  lines.forEach((l) => worldRoot.add(l));
  registerOverlay(...lines);
}

/** Swap the whole load: old meshes and lines go, new ones come, everything recalculates. */
setLoadReplacer(({ jumpers, formations }) => {
  const keep = new Set(jumpers);
  simJumpers.forEach((j) => {
    if (!keep.has(j)) j.getMesh()?.removeFromParent();
  });
  fleet.formations = formations;
  simJumpers = jumpers;
  (<any>window).simJumpers = simJumpers;
  simPlane.jumpers = simJumpers;
  for (const j of jumpers) {
    if (jumperGeometry) {
      if (!(j.getMesh() as any)?.geometry || (j.getMesh() as any).geometry !== jumperGeometry) attachJumperMesh(j);
      else if (!j.getMesh().parent) worldRoot.add(j.getMesh());
    } else if (!j.getMesh().parent) worldRoot.add(j.getMesh());
  }
  if (sceneReady) rebuildTrajectoryLines();
  recalculateSimulation();
  (simPlane as any).planeLoad?.render();
  renderTimelineMarkers();
});

// TODO: move into menubar with refactor
function startPlaneEdit() {
  if (planner) {
    planner.enter("jumprun");
    return;
  }
  cameraFollow.stop();
  StartEditPlane(
    simPlane.getMesh()!,
    camera,
    controls,
    300,
    700,
    () => {
      isEditingPlane = true;
      return {} as any;
    },
    isEditingPlane,
  );
}

(window as any).startPlaneEdit = startPlaneEdit;

// Render plane load editor at startup
(simPlane as any).planeLoad?.render();

/**
controls.touches = {
	ONE: THREE.TOUCH.ROTATE,
	TWO: THREE.TOUCH.DOLLY_PAN
} */
// set up camera controls
controls.addEventListener("start", () => {
  // leaving "Top view": re-enable picking/hover once the user moves the camera
  isEditingPlane = false;
  closePickMenu();
});

const followLabel = document.querySelector("#following-label");
const FOLLOW_MODE_NAMES: Record<FollowMode, string> = { free: "free", close: "close-up", chase: "chase", top: "top-down" };

function setFollowingLabel(name: string | null, mode: FollowMode | null = null) {
  if (!followLabel) return;
  followLabel.textContent = name
    ? `Following ${name}${mode ? ` (${FOLLOW_MODE_NAMES[mode]} view)` : ""}. Drag to orbit, scroll to zoom; right-drag or Esc stops.`
    : "You're not following anything. Click a jumper or the plane in the view, or pick one in Scene Objects.";
}

/** Scene-space velocity of the plane or a jumper's mesh, from its precalculated track. */
function velocityOfMesh(obj: THREE.Object3D): THREE.Vector3 | null {
  const t = Number((window as any).simulationTime) || 0;
  const track =
    fleet.planes.find((p) => p.getMesh() === obj)?.track ?? currentJumpers().find((j) => j.getMesh() === obj)?.track;
  const v = track?.getInterpolatedSample(t)?.velocity;
  return v ? v.clone() : null;
}

// Follow camera (ui/CameraFollow.ts): orbit/zoom while following, pan or Esc to stop
const cameraFollow = new CameraFollow({
  camera,
  controls,
  viewport: viewportEl as HTMLElement,
  canvas: renderer.domElement,
  velocityOf: velocityOfMesh,
  onChange: (name, mode) => setFollowingLabel(name, mode),
});
(window as any).cameraFollow = cameraFollow;

document
  .querySelector("#following-panel .panel-controls button")
  ?.addEventListener("click", () => cameraFollow.stop());

// Esc stops following (a menu open on top takes the Esc first)
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || isPickMenuOpen() || planner?.active) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  cameraFollow.stop();
});

/** Map a picked mesh (or one of its children) back to the plane or a jumper. */
function findSceneObjectFor(obj: THREE.Object3D): { type: "plane" | "jumper"; id: string } | null {
  // a zoomed-out marker stands in for its jumper or the plane
  if (obj.userData?.markerFor) obj = obj.userData.markerFor;
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    const plane = fleet.planes.find((p) => p.getMesh() === o);
    if (plane) return { type: "plane", id: plane.id };
    const j = simJumpers.find((x) => x.getMesh() === o);
    if (j) return { type: "jumper", id: j.id };
  }
  return null;
}

/**
 * Point the camera at an object and follow it. With `zoom` (or an `offset`) it flies
 * in close first; otherwise it follows from where it is now. Orbit/zoom keep
 * following; panning stops (see ui/CameraFollow.ts).
 */
function cameraFocus(
  object: THREE.Object3D | null,
  opts: { zoom?: boolean; offset?: THREE.Vector3; name?: string; mode?: FollowMode } = {},
) {
  if (!object) return;
  cameraFollow.follow(object, {
    mode: opts.mode ?? (opts.zoom || opts.offset ? "close" : "free"),
    offset: opts.offset,
    name: opts.name ?? null,
  });
}
(window as any).cameraFocus = cameraFocus;

// Selection highlight: a box around the selected plane/jumper
let selectionHelper: THREE.BoxHelper | null = null;
function setSelectedObject(object: THREE.Object3D | null) {
  if (selectionHelper) {
    unregisterOverlay(selectionHelper);
    scene.remove(selectionHelper);
    selectionHelper.geometry.dispose();
    (selectionHelper.material as THREE.Material).dispose();
    selectionHelper = null;
  }
  if (!object) return;
  selectionHelper = new THREE.BoxHelper(object, 0xffd700);
  (selectionHelper.material as THREE.LineBasicMaterial).depthTest = false;
  selectionHelper.renderOrder = 10;
  scene.add(selectionHelper);
  registerOverlay(selectionHelper);
}
(window as any).setSelectedObject = setSelectedObject;

function updateCameraFollow() {
  selectionHelper?.update();
  cameraFollow.update();
}

// Set when the tracks change so the scene redraws even while playback is paused
let forceSceneUpdate = false;

/** Exit order and times on every plane: index is the load order; exitOrder is its rank per plane. */
function scheduleLoad(jumpers: SimJumper[]) {
  jumpers.forEach((j) => {
    if (!fleet.planes.includes(j.plane as SimPlane)) j.plane = fleet.lead;
  });
  for (const p of fleet.planes)
    jumpers
      .filter((j) => j.plane === p)
      .sort((a, b) => a.index - b.index)
      .forEach((j, k) => (j.exitOrder = k));
  scheduleExits({ planes: fleet.planes, jumpers, formations: fleet.formations, exitIntervalS: fleet.exitIntervalS });
}
(window as any).scheduleLoad = () => scheduleLoad(currentJumpers());

/** Re-run the physics for the plane and every jumper, then redraw. */
export function recalculateSimulation() {
  const jumpers: SimJumper[] = Array.isArray((window as any).simJumpers)
    ? (window as any).simJumpers
    : simJumpers;
  applyJumpSettingsToPlane(simPlane);
  const jr = getDropzonePlan().jumprun;
  if (jr) applyJumprun(jr, simPlane, currentWindProfile());
  fleet.syncFromLead();
  fleet.planes.forEach((p) => p.precalculate(SIM_DURATION_S));
  scheduleLoad(jumpers);
  precalculateJumpers(jumpers, SIM_DURATION_S);
  updateSimWindow(jumpers);
  forceSceneUpdate = true;
  notifyRecalculated();
}
setRecalculationHandler(recalculateSimulation);

/** Back to the dropzone's default jumprun (dropzones.json), or straight along +X. */
(window as any).resetJumprunToDefault = () => {
  const pts = (window as any).defaultJumprunPoints;
  simPlane.initialPosition.set(0, simPlane.initialPosition.y, 0);
  simPlane.position.copy(simPlane.initialPosition);
  if (pts && pts.length === 2) {
    simPlane.changeDirection(new THREE.Vector3().subVectors(pts[1], pts[0]).setY(0));
  }
  recalculateSimulation();
};

// This function can be used to handle recalculations from external sources
export function handleForeignRecalculation() {
  recalculateSimulation();
  (simPlane as any).planeLoad?.render?.();
}

// === READY CHECKS ===

let meshReadyResolve: () => void;
let weatherReadyResolve: () => void;
let defaultPointsReadyResolve: () => void;

export const meshReady = new Promise<void>((resolve) => {
  meshReadyResolve = resolve;
});

export const weatherReady = new Promise<void>((resolve) => {
  weatherReadyResolve = resolve;
});

export function signalMeshReady() {
  meshReadyResolve?.();
}

export function signalWeatherReady() {
  weatherReadyResolve?.();
}

async function waitAllSystems(): Promise<void> {
  try {
    await Promise.all([meshReady, weatherReady]);
    console.log("Systems: OK");
  } catch (e) {
    console.error("One or more systems failed:", e);
  }
}

export const systemsOK = waitAllSystems();

// === JUMPER LOGIC ===
systemsOK.then(() => {
  notificationManager.success("Simulation loaded successfully!", {
    actions: [
      {
        label: "View Objects",
        callback: () => {
          console.log("Opening objects panel");
        },
      },
    ],
  });

  const defaultPoints = (window as any).defaultJumprunPoints;
  const planJumprun = getDropzonePlan().jumprun;
  if (planJumprun) {
    applyJumprun(planJumprun, simPlane, currentWindProfile());
    alignPoints = [simPlane.initialPosition.clone()];
  } else if (defaultPoints && defaultPoints.length === 2) {
    console.log("defaultPoints:", defaultPoints);
    alignPoints = [defaultPoints[0], defaultPoints[1]];
    drawAlignArrow();
    alignPlaneToJumprun(simPlane, defaultPoints[0], defaultPoints[1]);
  }
  if (alignPoints.length === 0) {
    notificationManager.warning("Jumprun is not aligned", {
      duration: 0,
      actions: [
        {
          label: "Align Jumprun",
          callback: () => {
            handleStartAlignJumprun();
          },
        },
      ],
    });
  }

  // start initial precalculation for jumpers
  fleet.syncFromLead();
  fleet.planes.forEach((p) => p.precalculate(SIM_DURATION_S));
  scheduleLoad(simJumpers);
  precalculateJumpers(simJumpers, SIM_DURATION_S);
  simJumpers.forEach((jumper) => worldRoot.add(jumper.getMesh()));
  updateSimWindow(simJumpers);

  // first load: zoop in to a view of the plane with the scenery behind it, then follow it
  cameraZoop.intro();

  renderTimelineMarkers();
  initializeSceneObjects({
    plane: () => simPlane,
    jumpers: () =>
      Array.isArray((window as any).simJumpers)
        ? ((window as any).simJumpers as SimJumper[])
        : simJumpers,
  });

  stlLoader.load(
    "fabs/skydiver_fix.stl",
    (geometry) => {
      // centre the model once; every jumper shares this geometry
      geometry.computeBoundingBox();
      const center = new THREE.Vector3();
      geometry.boundingBox?.getCenter(center);
      geometry.translate(-center.x, -center.y, -center.z);
      jumperGeometry = geometry;
      simJumpers.forEach(attachJumperMesh);
      forceSceneUpdate = true;
    },
    (xhr) => {
      console.log((xhr.loaded / xhr.total) * 100 + "% loaded");
    },
    (error) => {
      console.error("error with loading jumper", error);
    },
  );

  let simulationTime = 0;
  let lastFrameTime = performance.now();
  let lastSimTime = -1;
  const dir = new THREE.Vector3();
  const sph = new THREE.Spherical();

  function updateFromPrecalc(time) {
    for (const p of fleet.planes) {
      if (p === simPlane) continue;
      const s = p.track.getInterpolatedSample(time);
      const m = p.getMesh();
      if (m && s) {
        m.position.copy(s.position);
        if (s.angle instanceof THREE.Quaternion) m.quaternion.copy(s.angle);
      }
    }
    const planeSample = simPlane.track.getInterpolatedSample(time);
    // if (!planeSample) console.warn("No sample found at time", time);
    // console.log(
    //   "Time:",
    //   time,
    //   "Plane sample pos:",
    //   planeSample.position.toArray()
    // );
    const mesh = simPlane.getMesh();
    if (mesh && planeSample) {
      mesh.position.copy(planeSample.position);
      if (planeSample.angle instanceof THREE.Quaternion) {
        mesh.quaternion.copy(planeSample.angle);
      }
    }
    const EXIT_THRESHOLD_METERS = 2; // kinematic separation to consider exited
    simJumpers.forEach((jumper) => {
      const sample = jumper.track.getInterpolatedSample(time);
      if (!sample) return;
      jumper.getMesh().position.copy(sample.position);
      const ownPlane = (jumper.plane as SimPlane)?.track?.getInterpolatedSample(time) ?? planeSample;
      if (ownPlane) {
        const dist = sample.position.distanceTo(ownPlane.position);
        jumper.hasJumped = dist > EXIT_THRESHOLD_METERS;
      }

      const posFeet = sample.position.clone().multiplyScalar(3.28084);
      // edit quaternion of mesh to match angle
      const fixQuat = jumper.getMesh().userData.fixQuat as
        | THREE.Quaternion
        | undefined;
      if (sample.angle instanceof THREE.Quaternion) {
        jumper.getMesh().quaternion.copy(sample.angle);
        if (fixQuat) jumper.getMesh().quaternion.multiply(fixQuat);
      }
      jumper.getMesh().userData = {
        label: `Jumper #${jumper.index}`,
        time: sample.time.toFixed(2),
        pos: `(${posFeet.x.toFixed(1)}, ${posFeet.y.toFixed(
          1,
        )}, ${posFeet.z.toFixed(1)}) ft`,
        velocity: `(${sample.velocity.x.toFixed(
          1,
        )}, ${sample.velocity.y.toFixed(1)}, ${sample.velocity.z.toFixed(
          1,
        )}) m/s`,
        rotation: `(${jumper.angle.x.toFixed(1)}, ${jumper.angle.y.toFixed(
          1,
        )}, ${jumper.angle.z.toFixed(1)}) deg`,
      };
      const adj = adjustmentText(jumper, time);
      if (adj) jumper.getMesh().userData.adjusting = adj;
    });
    updateCanopyRigs(worldRoot, simJumpers, time);
    updateAdjustmentArrows(simJumpers, time, planner?.active ? planner.camera : camera, renderer.domElement.clientHeight);
  }

  sceneReady = true;
  rebuildTrajectoryLines();

  // Three.js stops the animation loop for good if a frame throws, which freezes the
  // whole app (planner exit, dragging, playback). Log the error and keep going.
  let lastFrameError = 0;
  renderer.setAnimationLoop(() => {
    try {
      renderFrame();
    } catch (err) {
      const t = performance.now();
      if (t - lastFrameError > 5000) {
        lastFrameError = t;
        console.error("Frame failed; continuing", err);
      }
    }
  });

  function renderFrame() {
    const now = performance.now();
    const deltaTime = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    // one clock: TimeScrubber advances currentTime while playing (and holds it while
    // the scrubber is dragged), so scrubbing mid-play just moves the playhead
    simulationTime = (window as any).advancePlayback?.(Math.min(deltaTime, 1)) ?? (window as any).currentTime;

    // expose for UI components (e.g., plane load jumped indicator)
    (window as any).simulationTime = simulationTime;

    if (simulationTime !== lastSimTime || forceSceneUpdate) {
      forceSceneUpdate = false;
      updateFromPrecalc(simulationTime);
      lastSimTime = simulationTime;
    }
    if (!planner?.active) controls.update();

    updateTrajectoryLines(lines, simulationTime);

    // Update PlaneLoad UI every frame for dynamic values
    (simPlane as any).planeLoad?.updateRuntime?.();

    (window as any).mapScene?.update();

    planner?.update(simulationTime);
    updateMarkers(planner?.active ? planner.camera : camera, renderer, simulationTime);
    weatherRenderer.render(scene, planner?.active ? planner.camera : camera, { planner: planner?.active });

    camera.getWorldDirection(dir);
    sph.setFromVector3(dir);
    // thx guy on stack overflow <3
    if (compass) {
      (compass as HTMLElement).style.transform = `rotate(${
        THREE.MathUtils.radToDeg(sph.theta) - 180
      }deg)`;
    }
    if (!planner?.active)
      checkHoverIntersect([
        ...planeMeshes(),
        ...simJumpers.map((j) => j.getMesh()),
      ] as Array<THREE.Object3D | null>);
    if (!planner?.active) updateCameraFollow();
  }
});
/**
 *potentially uncomment later, need to downsize 3mf file or get new stl from amanda
 */

// === ANIMATION LOOP ===

// === RESIZE HANDLER ===
// (sizing is handled by the ResizeObserver on #viewport above)

loadDropzones(scene).catch(console.error);
initializePlaneManager(scene, simPlane);
initializeDock();
initializeTimeline();
planner = initializePlanner({
  scene,
  world: worldRoot,
  renderer,
  perspective: camera,
  controls,
  viewport: viewportEl as HTMLElement,
  plane: () => simPlane,
  jumpers: () => ((window as any).simJumpers as SimJumper[]) ?? simJumpers,
});
(window as any).planner = planner; // weather updates wait for planner drags (WeatherService)
initializeWindWidget(camera, controls);
initializeWeatherPanel();
initializeJumpSettingsPanel();
initializeFileMenu();
initializePlanSourceBanner();
initializeAdjustmentArrowsToggle();
(window as any).forceSceneUpdate = () => (forceSceneUpdate = true);
initializeWeatherMenu();
// "zoop" to the ground or back up to jump height (viewport buttons, G / J)
const cameraZoop = initializeCameraZoop({
  camera,
  controls,
  viewport: viewportEl as HTMLElement,
  release: () => cameraFollow.stop(),
  followPlane: () => cameraFocus(simPlane.getMesh(), { name: "the plane" }),
  planeMesh: () => simPlane.getMesh(),
  plannerActive: () => !!planner?.active,
});
initializeMarkers(scene, () => simPlane, () => ((window as any).simJumpers as SimJumper[]) ?? simJumpers);

// Global access to notification system for use across the application
(window as any).notificationManager = notificationManager;
