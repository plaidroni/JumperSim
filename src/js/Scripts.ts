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
import { handlePlaneSelection, initializePlaneManager } from "./PlaneSelect";
import {
  createDynamicTrajectoryLine,
  updateTrajectoryLines,
  visualizeJumpers,
} from "./ui/TrajectoryLines";
import { loadJumpFormation } from "./exampleData/Formations";
import { Formation } from "./classes/Formations";
import { addTooltipToggle } from "./Menubar";
import { initializeDock } from "./editor/Dock";
import { initializeTimeline, renderTimelineMarkers } from "./editor/Timeline";
import { initializeSceneObjects } from "./panels/SceneObjects";
import { initializeWindWidget } from "./panels/WindWidget";
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

// === THREE SETUP ===
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer();
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.5, // was 0.1; a larger near plane avoids z-fighting on distant terrain
  100000,
);
const controls = new OrbitControls(camera, renderer.domElement);

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
scene.add(light);
const ambient = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambient);
scene.add(new THREE.AxesHelper(5));

let clock = new THREE.Clock();

camera.position.set(0, 108, 30);
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

// const gridHelper = new THREE.GridHelper(1609, 16); // 16 subdivisions = 100m spacing
// scene.add(gridHelper);

// === LOOKING AT SCENE OBJECT ===
let followTarget: THREE.Object3D | null = null;
let isUserControllingCamera = false;
let isEditingPlane = false;
// === EVENT LISTENERS ===

let isAligningJumprun: Boolean = false;
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
  if (moved > 4 || isEditingPlane || isAligningJumprun) return;
  onMouseMove(e);
  pickAt([simPlane.getMesh(), ...simJumpers.map((j) => j.getMesh())]);
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
        points.push(intersects[0].point.clone());
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
  askForRefresh(() => {
    simPlane.precalculate(300);
    simJumpers.forEach((j) => j.precalculate(300));
  }, true);
}

function drawAlignArrow() {
  if (alignArrow) {
    scene.remove(alignArrow);
    alignArrow = null;
  }

  const [p1, p2] = alignPoints;
  const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
  const length = p1.distanceTo(p2);
  alignArrow = new THREE.ArrowHelper(dir, p1, length, 0xff0000, length * 0.1);

  scene.add(alignArrow);
}

document
  .getElementById("start-align-jumprun")
  ?.addEventListener("click", handleStartAlignJumprun);

/** Select (and follow) the plane/jumper under the mouse, if any. */
function pickAt(objects: Array<THREE.Object3D | null>) {
  raycaster.setFromCamera(mouse, camera);
  const valid = objects.filter((o): o is THREE.Object3D => o != null);
  if (valid.length === 0) return;
  const hit = raycaster.intersectObjects(valid, true)[0];
  if (!hit) return;
  const picked = findSceneObjectFor(hit.object);
  if (!picked) return;
  const root =
    picked.type === "plane"
      ? simPlane.getMesh()
      : simJumpers.find((j) => j.id === picked.id)?.getMesh() ?? hit.object;
  cameraFocus(root, {
    name:
      picked.type === "plane"
        ? "the plane"
        : `Jumper ${(simJumpers.find((j) => j.id === picked.id)?.index ?? 0) + 1}`,
  });
  window.dispatchEvent(new CustomEvent("scene-object-picked", { detail: picked }));
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
  new THREE.Vector3(0, 3962, 0),
  90,
  new THREE.Vector3(90, 0, 0),
);
handlePlaneSelection("twin-otter", scene, simPlane);
// === SIMULATION DATA ===

let formations: Formation[] = [];
let simJumpers: SimJumper[] = [];
(<any>window).simPlane = simPlane;
(<any>window).simJumpers = simJumpers;
// attach PlaneLoad instance to plane for centralized state
(simPlane as any).planeLoad = new PlaneLoad(simPlane);
// keep plane reference to jumpers array in sync
simPlane.jumpers = simJumpers;

try {
  // const formationData1 = await loadJumpFormation("/formations/3way6a.jump");
  const formationData1 = await loadJumpFormation("/formations/jff2.jump");
  console.log("Loaded formation data:", formationData1);
  const formation1 = new Formation(formationData1);
  // formation1.createJumpersForPlane(simPlane, formationData1.jumpers);
  simJumpers = createDefaultSimJumpers(10, simPlane);
  simPlane.addFormation(formation1);

  // const formationData2 = await loadJumpFormation("/formations/another.jump");
  // const formation2 = new Formation(formationData2);
  // formation2.createJumpersForPlane(simPlane, formationData2.jumpers);
  // simPlane.addFormation(formation2);

  formations = simPlane.formations;
  // Gather all jumpers from all formations
  simJumpers = formations.flatMap((f) => f.getAllJumpers());
  simJumpers.push(...createDefaultSimJumpers(10, simPlane));
  // Group formation jumpers together and reindex sequentially
  simJumpers = groupAndReindexJumpers(simPlane, simJumpers);
  (<any>window).simJumpers = simJumpers;
  simPlane.jumpers = simJumpers;
  (simPlane as any).planeLoad?.render();

  // Success notification with action button
  notificationManager.success(
    `Formation loaded: ${formations.length} formation(s) with ${simJumpers.length} jumpers`,
    {
      duration: 5000,
      actions: [
        {
          label: "View Objects",
          callback: () => {
            // Show objects panel - find and maximize it
            const objectsPanel = document.querySelector(
              "#objects-panel",
            ) as HTMLElement;
            if (objectsPanel) {
              objectsPanel.style.visibility = "visible";
            }
          },
        },
      ],
    },
  );
} catch (e) {
  // fallback: no formation, use default jumpers
  simJumpers = createDefaultSimJumpers(10, simPlane);
  simJumpers = groupAndReindexJumpers(simPlane, simJumpers);
  (<any>window).simJumpers = simJumpers;
  simPlane.jumpers = simJumpers;
  (simPlane as any).planeLoad?.render();
  // Warning notification for fallback scenario
  notificationManager.warning(
    "Formation loading failed - using default jumpers",
    {
      duration: 6000,
    },
  );
}

// TODO: move into menubar with refactor
function startPlaneEdit() {
  followTarget = null;
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
  // deprecate, as soon as the user clicks it is "panning"
  isUserControllingCamera = false;
  if (followTarget) setFollowingLabel(null);
  followTarget = null;
  followOffset = DEFAULT_FOLLOW_OFFSET.clone();
});

// use control.touches to disable following if user is panning (not rotating)
controls.addEventListener("end", () => {
  isUserControllingCamera = false;
});

let cameraOffset = new THREE.Vector3(10, 10, 10);
const DEFAULT_FOLLOW_OFFSET = new THREE.Vector3(100, 100, 100);
let followOffset = DEFAULT_FOLLOW_OFFSET.clone();
const followLabel = document.querySelector("#following-label");

document
  .querySelector("#following-panel .panel-controls button")
  ?.addEventListener("click", () => {
    followTarget = null;
    isUserControllingCamera = true;
    setFollowingLabel(null);
  });

function setFollowingLabel(name: string | null) {
  if (!followLabel) return;
  followLabel.textContent = name
    ? `Following ${name}.`
    : "You're not following anything. Pick a jumper in Scene Objects.";
}

/** Map a picked mesh (or one of its children) back to the plane or a jumper. */
function findSceneObjectFor(obj: THREE.Object3D): { type: "plane" | "jumper"; id: string } | null {
  const planeMesh = simPlane.getMesh();
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    if (planeMesh && o === planeMesh) return { type: "plane", id: simPlane.id };
    const j = simJumpers.find((x) => x.getMesh() === o);
    if (j) return { type: "jumper", id: j.id };
  }
  return null;
}

/**
 * Point the camera at an object. With `zoom`, it flies in close (offset chosen from
 * the object's motion) and then follows; otherwise it follows from where it is now.
 * Any manual orbit/zoom cancels it (see controls "start").
 */
function cameraFocus(
  object: THREE.Object3D | null,
  opts: { zoom?: boolean; offset?: THREE.Vector3; name?: string } = {},
) {
  if (!object) return;
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  if (opts.offset) followOffset = opts.offset.clone();
  else if (opts.zoom) followOffset = new THREE.Vector3(20, 10, 20);
  else followOffset = camera.position.clone().sub(center);
  followTarget = object;
  isUserControllingCamera = false;
  setFollowingLabel(opts.name ?? null);
}
(window as any).cameraFocus = cameraFocus;

// Selection highlight: a box around the selected plane/jumper
let selectionHelper: THREE.BoxHelper | null = null;
function setSelectedObject(object: THREE.Object3D | null) {
  if (selectionHelper) {
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
}
(window as any).setSelectedObject = setSelectedObject;

// Follow: the camera moves with the target (no lag behind a falling jumper) and eases
// toward the chosen offset at the same speed regardless of frame rate.
const FOLLOW_EASE_S = 0.35;
let lastFollowCenter: THREE.Vector3 | null = null;
let lastFollowObj: THREE.Object3D | null = null;
let lastFollowTime = performance.now();
function updateCameraFollow() {
  selectionHelper?.update();
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastFollowTime) / 1000);
  lastFollowTime = now;
  if (followTarget && !isUserControllingCamera) {
    const box = new THREE.Box3().setFromObject(followTarget);
    const center = box.getCenter(new THREE.Vector3());
    if (lastFollowObj === followTarget && lastFollowCenter) {
      camera.position.add(center.clone().sub(lastFollowCenter)); // carry along
    }
    lastFollowObj = followTarget;
    lastFollowCenter = center.clone();

    controls.target.copy(center);
    const alpha = 1 - Math.exp(-dt / FOLLOW_EASE_S);
    camera.position.lerp(center.clone().add(followOffset), alpha);
    controls.update();
  } else {
    lastFollowObj = null;
    lastFollowCenter = null;
  }
}

// Set when the tracks change so the scene redraws even while playback is paused
let forceSceneUpdate = false;

/** Re-run the physics for the plane and every jumper, then redraw. */
export function recalculateSimulation() {
  const jumpers: SimJumper[] = Array.isArray((window as any).simJumpers)
    ? (window as any).simJumpers
    : simJumpers;
  simPlane.precalculate(300);
  jumpers.forEach((jumper) => jumper.precalculate(300));
  forceSceneUpdate = true;
  notifyRecalculated();
}
setRecalculationHandler(recalculateSimulation);

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
  if (defaultPoints && defaultPoints.length === 2) {
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
  simPlane.precalculate(300);

  simJumpers.forEach((jumper) => {
    jumper.precalculate(300);
    scene.add(jumper.getMesh());
  });

  followTarget = simPlane.getMesh();
  isUserControllingCamera = false;
  setFollowingLabel("the plane");

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
      simJumpers.forEach((jumper) => {
        const color = new THREE.Color(
          Math.random(),
          Math.random(),
          Math.random(),
        );

        const material = new THREE.MeshBasicMaterial({
          color,
          wireframe: true,
        });

        const mesh = new THREE.Mesh(geometry, material);

        mesh.scale.set(1, 1, 1);

        geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        if (geometry.boundingBox) {
          geometry.boundingBox.getCenter(center);
        }
        mesh.geometry.translate(-center.x, -center.y, -center.z);
        const forward = new THREE.Vector3(1, 0, 0);
        // const fixQuat = new THREE.Quaternion().setFromAxisAngle(
        //   forward,
        //   -Math.PI / 2
        // );
        jumper.setMesh(mesh);

        // mesh.userData.fixQuat = fixQuat.clone();
        // set mesh rotation upright

        if (jumper.isInFormation && jumper.formationOffset.lengthSq() > 0) {
          mesh.position.copy(jumper.formationOffset);
          const targetDir = jumper.formationOffset.clone().normalize().negate();
          // console.log("formation offset:", jumper.formationOffset);
          console.log("targetDir:", jumper.angle);
          mesh.quaternion.copy(jumper.angle);
        } else {
          // mesh.quaternion.copy(fixQuat);
        }
        scene.add(jumper.getMesh());
      });
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
      if (planeSample) {
        const dist = sample.position.distanceTo(planeSample.position);
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
    });
  }

  const lines = simJumpers.map(createDynamicTrajectoryLine);
  lines.forEach((l) => scene.add(l));

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const deltaTime = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    simulationTime = (window as any).isPlaying
      ? simulationTime + deltaTime
      : (window as any).currentTime;

    // expose for UI components (e.g., plane load jumped indicator)
    (window as any).simulationTime = simulationTime;

    (window as any).updateScrubber?.(simulationTime);

    if (simulationTime !== lastSimTime || forceSceneUpdate) {
      forceSceneUpdate = false;
      updateFromPrecalc(simulationTime);
      lastSimTime = simulationTime;
    }
    controls.update();

    updateTrajectoryLines(lines, simulationTime);

    // Update PlaneLoad UI every frame for dynamic values
    (simPlane as any).planeLoad?.updateRuntime?.();

    (window as any).mapScene?.update();

    renderer.render(scene, camera);

    camera.getWorldDirection(dir);
    sph.setFromVector3(dir);
    // thx guy on stack overflow <3
    if (compass) {
      (compass as HTMLElement).style.transform = `rotate(${
        THREE.MathUtils.radToDeg(sph.theta) - 180
      }deg)`;
    }
    checkHoverIntersect([
      simPlane.getMesh(),
      ...simJumpers.map((j) => j.getMesh()),
    ] as Array<THREE.Object3D | null>);
    updateCameraFollow();
  });
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
initializeWindWidget(camera, controls);

// Global access to notification system for use across the application
(window as any).notificationManager = notificationManager;
