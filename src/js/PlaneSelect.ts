import { PLANE_READABILITY, worldRoot } from "./core/WorldScale";
import { requestRecalculation } from "./core/data/SimulationVariables";
import { SIM_DURATION_S } from "./physics/SimWindow";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SimPlane } from "./classes/SimEntities";
import { AIRCRAFT, AircraftId, aircraft, isAircraftId } from "./fleet/Aircraft";

/**
 * Aircraft models, one per plane (specs/formation-jumps.md §5.2). Each model file is
 * loaded once and cloned for every plane that flies it. `unitsToMetres` converts each
 * model to true size; aircraft are then drawn PLANE_READABILITY× larger, and so are
 * the door and floater spots, so jumpers leave from the drawn door.
 */

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();
/** Latest model request per plane, so a slow load can't overwrite a newer choice. */
const pending = new WeakMap<SimPlane, number>();
let requestSeq = 0;

/** Kept for code that reads the old table (same shape as before). */
export const planeConfigs = Object.fromEntries(
  Object.values(AIRCRAFT).map((a) => [a.id, { file: a.file, unitsToMetres: a.unitsToMetres, door: a.door, color: a.color, name: a.name, rotation: a.rotation }]),
);

function loadModel(file: string): Promise<THREE.Object3D> {
  let p = cache.get(file);
  if (!p) {
    p = new Promise((resolve, reject) => {
      loader.load(
        file,
        (gltf) => resolve(gltf.scene),
        (xhr) => {
          const progress = Math.round((xhr.loaded / xhr.total) * 100);
          updateStatus(Number.isFinite(progress) ? `Loading… ${progress}%` : "Loading…");
        },
        (err) => reject(err),
      );
    });
    cache.set(file, p);
    p.catch(() => cache.delete(file));
  }
  return p;
}

const scaled = (o: { right: number; up: number; back: number }) => ({
  right: o.right * PLANE_READABILITY,
  up: o.up * PLANE_READABILITY,
  back: o.back * PLANE_READABILITY,
});

/** Give a plane the model of its aircraft type (and its door and floater spots). */
export function loadPlaneModel(plane: SimPlane): Promise<void> {
  const spec = aircraft(plane.aircraftId);
  // door and spots apply at once; the mesh follows when the model arrives
  plane.doorOffset = scaled(spec.door);
  plane.floaterSpots = spec.floaterSpots.map(scaled);
  const seq = ++requestSeq;
  pending.set(plane, seq);
  updateStatus("Loading…");
  return loadModel(spec.file).then(
    (source) => {
      if (pending.get(plane) !== seq) return;
      const model = source.clone(true);
      model.traverse((child: any) => {
        if (child.isMesh)
          child.material = new THREE.MeshStandardMaterial({ color: plane.planeColor || spec.color, wireframe: true });
      });
      model.scale.setScalar(spec.unitsToMetres * PLANE_READABILITY);
      const [xDeg, yDeg, zDeg] = spec.rotation;
      model.rotation.set(THREE.MathUtils.degToRad(xDeg), THREE.MathUtils.degToRad(yDeg), THREE.MathUtils.degToRad(zDeg));
      addNoseLine(model);
      model.userData.label = plane.label || "Plane";
      model.userData.planeId = plane.id;
      const wrapper = new THREE.Group(); // the plane's mesh: rotations from the track go here
      wrapper.add(model);
      wrapper.userData.label = plane.label || "Plane";
      wrapper.userData.planeId = plane.id;
      plane.getMesh()?.removeFromParent();
      plane.setMesh(wrapper);
      worldRoot.add(wrapper);
      updateStatus("");
      plane.precalculate(SIM_DURATION_S);
      requestRecalculation(); // exits move to the new aircraft's door
    },
    (error) => {
      console.error("Error loading plane:", error);
      updateStatus(`Couldn't load the ${spec.name} model`, true);
    },
  );
}

/** Recolour a plane's wireframe (chip colour). */
export function setPlaneColor(plane: SimPlane, color: number) {
  plane.planeColor = color;
  plane.getMesh()?.traverse((c: any) => {
    if (c.isMesh && c.material?.color) c.material.color.setHex(color);
  });
}

/** Old entry point: change a plane's aircraft. */
export function handlePlaneSelection(selectedPlane: string, _scene: THREE.Scene, simPlane: SimPlane) {
  if (!isAircraftId(selectedPlane)) {
    updateStatus("No plane selected");
    return;
  }
  simPlane.aircraftId = selectedPlane as AircraftId;
  loadPlaneModel(simPlane);
}

// Small inline status next to the aircraft picker: only shown while loading or on error
function updateStatus(message: string, isError = false) {
  const el = document.getElementById("plane-status");
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
  el.classList.toggle("is-error", isError);
}

/** The aircraft picker edits the plane selected in Plane Settings (the lead by default). */
export function initializePlaneManager(_scene: THREE.Scene, simPlane: SimPlane) {
  const planeSelect = document.getElementById("plane-select") as HTMLSelectElement | null;
  if (planeSelect) {
    planeSelect.value = simPlane.aircraftId;
    planeSelect.addEventListener("change", () => {
      const w = window as any;
      const target: SimPlane = w.planeLoadSelectedPlane?.() ?? w.fleet?.lead ?? simPlane;
      if (!isAircraftId(planeSelect.value)) return;
      if (w.fleet) w.fleet.setAircraft(target, planeSelect.value);
      else {
        target.aircraftId = planeSelect.value;
        loadPlaneModel(target);
      }
    });
  }
}

(<any>window).PlaneManager = {
  handlePlaneSelection,
  loadPlaneModel,
  planeConfigs,
};

function addNoseLine(model: THREE.Object3D) {
  const length = 10;
  const noseLineGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, length),
  ]);
  const noseLineMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
  model.add(new THREE.Line(noseLineGeometry, noseLineMaterial));
}
