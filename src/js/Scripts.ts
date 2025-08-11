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
import { initializePanelManager } from "./Menubar";
// Notification system for displaying alerts and feedback to users
// Usage: notificationManager.success/error/warning/info(message, options)
import { notificationManager } from "./classes/NotificationManager";
import { alignPlaneToJumprun } from "./utils/AlignJumprun";
import { askForRefresh } from "./core/data/SimulationVariables";
import { StartEditPlane } from "./ui/PlaneEdit";
import { createWindParticles, updateWindParticles } from "./classes/WindParticles";

// === THREE SETUP ===
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer();
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100000
);
const controls = new OrbitControls(camera, renderer.domElement);
let windParticles: THREE.Points | null = null;


renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

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
const tooltip = document.getElementById("info-tooltip");
const compass = document.getElementById("compass");
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let clickedThisFrame = false;

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

window.addEventListener("mousedown", () => {
  if (controls) {
    clickedThisFrame = true;

    // if this causes issues or lag put into animate frame instead

    setTimeout(() => {
      clickedThisFrame = false;
    }, 1);
  }
});

function onMouseMove(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  if (tooltip) {
    (tooltip as HTMLElement).style.left = `${event.clientX + 10}px`;
    (tooltip as HTMLElement).style.top = `${event.clientY + 10}px`;
  }
}

document.addEventListener("mousemove", onMouseMove);

function collectTwoAlignPoints(
  mapPlane: THREE.Object3D
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

  const mapPlane = (window as any).mapPlane
    ? (window as any).mapPlane
    : (window as any).gridHelper;

  notificationManager.info(
    "Click two points on the map to set jumprun direction."
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

      if (data?.label && tooltip) {
        let html = `<strong>${data.label}</strong><br>`;
        for (const key in data)
          if (key !== "label") html += `${key}: ${data[key]}<br>`;
        (tooltip as HTMLElement).innerHTML = html;
        (tooltip as HTMLElement).style.display = "block";
      }

      if (clickedThisFrame) {
        console.log(followTarget, obj);

        followTarget = obj;
        const box = new THREE.Box3().setFromObject(obj);
        const center = box.getCenter(new THREE.Vector3());
        cameraOffset = new THREE.Vector3().subVectors(camera.position, center);

        clickedThisFrame = false;
      }

      return;
    }

    if (tooltip) (tooltip as HTMLElement).style.display = "none";
  } catch (err) {
    console.warn("Raycast error:", err);
    if (tooltip) (tooltip as HTMLElement).style.display = "none";
  }
}

// === PLANE +JUMPER + SIMULATION ===
const stlLoader = new STLLoader();
const simPlane = new SimPlane(
  new THREE.Vector3(0, 3962, 0),
  90,
  new THREE.Vector3(90, 0, 0)
);
handlePlaneSelection("twin-otter", scene, simPlane);
// === SIMULATION DATA ===

let formations: Formation[] = [];
let simJumpers: SimJumper[] = [];

try {
  // const formationData1 = await loadJumpFormation("/formations/3way6a.jump");
  const formationData1 = await loadJumpFormation("/formations/jff2.jump");
  console.log("Loaded formation data:", formationData1);
  const formation1 = new Formation(formationData1);
  formation1.createJumpersForPlane(simPlane, formationData1.jumpers);

  simPlane.addFormation(formation1);

  // const formationData2 = await loadJumpFormation("/formations/another.jump");
  // const formation2 = new Formation(formationData2);
  // formation2.createJumpersForPlane(simPlane, formationData2.jumpers);
  // simPlane.addFormation(formation2);

  formations = simPlane.formations;
  // Gather all jumpers from all formations
  simJumpers = formations.flatMap((f) => f.getAllJumpers());

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
              "#objects-panel"
            ) as HTMLElement;
            if (objectsPanel) {
              objectsPanel.style.visibility = "visible";
            }
          },
        },
      ],
    }
  );
} catch (e) {
  // fallback: no formation, use default jumpers

  // Warning notification for fallback scenario
  notificationManager.warning(
    "Formation loading failed - using default jumpers",
    {
      duration: 6000,
    }
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
    isEditingPlane
  );
}

(window as any).startPlaneEdit = startPlaneEdit;

// load active objects into the panel
const panelBody = document.querySelector("#objects-panel .panel-body");
if (panelBody) (panelBody as HTMLElement).innerHTML = "";
const planeEntry = document.createElement("div");
planeEntry.className = "object-entry";
planeEntry.innerHTML = `
  <span>Plane</span>
  <button class="focus-button" data-type="plane">👀</button>
`;
if (panelBody) (panelBody as HTMLElement).appendChild(planeEntry);

simJumpers.forEach((jumper, i) => {
  const jumperEntry = document.createElement("div");
  jumperEntry.className = "object-entry";
  jumperEntry.innerHTML = `
    <span>Jumper ${i}</span>
    <button class="focus-button" data-type="jumper" data-index="${i}">👀</button>
  `;
  if (panelBody) (panelBody as HTMLElement).appendChild(jumperEntry);
});

document.querySelectorAll(".focus-button").forEach((btn) =>
  btn.addEventListener("click", (e) => {
    const button = e.currentTarget as HTMLButtonElement;
    const type = button.dataset.type;
    const index = Number(button.dataset.index);

    const objectToFollow =
      type === "plane" ? simPlane.getMesh() : simJumpers[index].getMesh();
    // follow behavior
    if (followTarget === objectToFollow) {
      // followTarget = null;
      button.classList.remove("following");
    } else {
      followTarget = objectToFollow;
      document
        .querySelectorAll(".focus-button.following")
        .forEach((b) => b.classList.remove("following"));
      button.classList.add("following");
    }
  })
);

/**
controls.touches = {
	ONE: THREE.TOUCH.ROTATE,
	TWO: THREE.TOUCH.DOLLY_PAN
} */
// set up camera controls
controls.addEventListener("start", () => {
  // deprecate, as soon as the user clicks it is "panning"
  isUserControllingCamera = false;
  followTarget = null;
  document
    .querySelectorAll(".focus-button.following")
    .forEach((b) => b.classList.remove("following"));
});

// use control.touches to disable following if user is panning (not rotating)
controls.addEventListener("end", () => {
    isUserControllingCamera = false;
});

let cameraOffset = new THREE.Vector3(10, 10, 10);
const followButton = document.querySelector("#following-panel");
const followLabel = document.querySelector("#following-label");

followButton?.addEventListener("click", () => {
  followTarget = null;
  isUserControllingCamera = true;
});

function updateCameraFollow() {
  if (followTarget && !isUserControllingCamera) {
    const box = new THREE.Box3().setFromObject(followTarget);
    const center = box.getCenter(new THREE.Vector3());

    controls.target.copy(center);
    camera.position.lerp(
      center.clone().add(new THREE.Vector3(100, 100, 100)),
      0.05
    );
    controls.update();
  }
}

// This function can be used to handle recalculations from external sources
export function handleForeignRecalculation() {
  simPlane.precalculate(300);
  simJumpers.forEach((jumper) => jumper.precalculate(300));
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

  stlLoader.load(
    "fabs/skydiver_fix.stl",
    (geometry) => {
      simJumpers.forEach((jumper) => {
        const color = new THREE.Color(
          Math.random(),
          Math.random(),
          Math.random()
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
    }
  );

  if ((window as any).currentWeatherData) {
    console.log("Initializing wind particles with weather data");
    windParticles = createWindParticles(scene, (window as any).currentWeatherData);
  } else {
    console.warn("No weather data available for wind particles");
  }


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
    simJumpers.forEach((jumper) => {
      const sample = jumper.track.getInterpolatedSample(time);
      if (!sample) return;
      jumper.getMesh().position.copy(sample.position);

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
          1
        )}, ${posFeet.z.toFixed(1)}) ft`,
        velocity: `(${sample.velocity.x.toFixed(
          1
        )}, ${sample.velocity.y.toFixed(1)}, ${sample.velocity.z.toFixed(
          1
        )}) m/s`,
        rotation: `(${jumper.angle.x.toFixed(1)}, ${jumper.angle.y.toFixed(
          1
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

    (window as any).updateScrubber?.(simulationTime);

    if (simulationTime !== lastSimTime) {
      updateFromPrecalc(simulationTime);
      lastSimTime = simulationTime;
    }
    // Update wind particles only when playing
    if (windParticles) {
      updateWindParticles(windParticles, simulationTime, (window as any).isPlaying);
    }

    controls.update();

    updateTrajectoryLines(lines, simulationTime);

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
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

loadDropzones(scene).catch(console.error);
initializePlaneManager(scene, simPlane);
initializePanelManager();

// Global access to notification system for use across the application
(window as any).notificationManager = notificationManager;
