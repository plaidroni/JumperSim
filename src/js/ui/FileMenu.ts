// File menu: save and load the whole environment as .jsim (specs/formation-jumps.md §12).

import * as THREE from "three";
import { SimJumper, SimPlane } from "../classes/SimEntities";
import { notificationManager } from "../classes/NotificationManager";
import {
  JSIM_FORMAT,
  JSIM_VERSION,
  JsimEnvironment,
  JsimError,
  jsimFileName,
  parseJsim,
  serializeJsim,
} from "../core/data/JsimFile";
import { DEFAULT_JUMP_NAME, getJumpSettings, onJumpSettingsChanged, setJumpSettings } from "../core/data/JumpSettings";
import { replaceLoad } from "../core/data/LoadStore";
import { requestRecalculation } from "../core/data/SimulationVariables";
import {
  getDropzonePlan,
  getPlanSource,
  loadPlanForDropzone,
  restoreSavedDropzonePlanJSON,
  saveActivePlanToDropzone,
  savedDropzonePlanJSON,
  setPlanSource,
  useFilePlan,
} from "../dropzone/DropzonePlan";
import { getFleet } from "../fleet/Fleet";
import { FormationSequence } from "../formations/FormationSequence";
import { captureEnvironment, importJumpText, restoreEnvironment } from "../formations/ImportJump";
import { selectDropzoneByRef, setDropzoneChangeGuard } from "../LocationSelect";
import { weatherService } from "../weather/WeatherService";
import pkg from "../../../package.json";

const AUTOSAVE_KEY = "jumpersim.autosave.v1";
const AUTOSAVE_ON_KEY = "jumpersim.autosave.enabled";
const LAST_SAVE_KEY = "jumpersim.lastSaveAt";
const M_TO_FT = 3.28084;

interface OpenFile {
  name: string;
  handle: any | null;
}

let currentFile: OpenFile | null = null;
let unsaved = false;
let applying = false;
let autosaveTimer: number | null = null;

const w = () => window as any;
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
      return true;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------- collect

/** The environment as it is now (§12.2). */
export function collectEnvironment(): JsimEnvironment {
  const fleet = getFleet()!;
  const lead = fleet.lead as any;
  const jumpers: SimJumper[] = [...(w().simJumpers ?? [])];
  const dz = w().selectedDropzone;
  const weather = weatherService.exportState();
  const cam: THREE.PerspectiveCamera | undefined = w().simulationCamera;
  const controls = w().simulationControls;
  return {
    format: JSIM_FORMAT,
    version: JSIM_VERSION,
    savedAt: new Date().toISOString(),
    appVersion: (pkg as any).version ?? "",
    jump: { ...getJumpSettings() },
    dropzone: dz
      ? {
          name: String(dz.name ?? "").replace(/ \(from file\)$/, ""),
          latitude: Number(dz.latitude),
          longitude: Number(dz.longitude),
          elevationFt: weather && Number.isFinite(weather.elevationM) ? Math.round(weather.elevationM * M_TO_FT) : null,
          country: String(dz.country ?? ""),
        }
      : null,
    plan: JSON.parse(JSON.stringify(getDropzonePlan())),
    load: {
      exitIntervalS: fleet.exitIntervalS,
      linkedFormation: lead.linkedFormation === "none" ? "none" : "round",
      roundSettings: { slotRadiusM: "auto", breakoffFt: 4500, breakoffDistanceM: "auto", ...(lead.roundSettings ?? {}) },
      flockSettings: { layout: "arrowhead", spacingM: 15, stackM: 0, breakoffFt: 5500, ...(lead.flockSettings ?? {}) },
      minDeploySeparationM: Number(lead.minDeploySeparationM ?? 150),
      fleet: {
        layout: fleet.layout,
        spacing: { ...fleet.spacing },
        planes: fleet.planes.map((p) => ({ id: p.id, label: p.label, aircraft: p.aircraftId, floaters: p.floaters, goOffsetS: p.goOffsetS })),
      },
      jumpers: [...jumpers]
        .sort((a, b) => a.index - b.index)
        .map((j: any) => ({
          id: j.id,
          plane: (j.plane as SimPlane)?.id ?? fleet.lead.id,
          exitOrder: j.exitOrder,
          initialExit: !!j.initialExit,
          wantsFloat: !!j.wantsFloat,
          inExitPiece: !!j.inExitPiece,
          name: j.name ? String(j.name) : null,
          color: j.color ?? meshHex(j),
          position: j.flyingStyle,
          tracking: !!j.tracking,
          weightKg: j.weight,
          extraWeightKg: j.extraWeight ?? 0,
          suit: j.suitType ?? "normal",
          canopySqft: j.canopySize,
          pullFt: j.pullAltitudeFt,
          linked: !!j.linked,
          formationSlot: Number.isInteger(j.formationSlot) ? j.formationSlot : null,
          laneIndex: Number.isInteger(j.laneIndex) ? j.laneIndex : null,
          freefallPatternId: j.freefallPatternId ?? null,
        })),
      formations: fleet.formations.map((f) => ({
        id: f.id,
        title: f.title,
        source: f.source,
        settings: { ...f.settings },
        points: f.points,
        members: f.members.map((m) => m?.id ?? null),
      })),
    },
    weather: weather
      ? { mode: "saved", override: weatherService.overrideName, state: weather }
      : { mode: "live", override: null, state: null },
    view: {
      time: Number(w().currentTime) || 0,
      speed: Number(w().playbackSpeed) || 1,
      camera:
        cam && controls
          ? { position: cam.position.toArray(), target: controls.target.toArray() }
          : null,
    },
  };
}

function meshHex(j: SimJumper): string | null {
  const c = (j.getMesh() as any)?.material?.color;
  return c?.getHexString ? `#${c.getHexString()}` : null;
}

// ---------------------------------------------------------------- apply

/** Rebuild the environment from a parsed file (§12.5 steps 3–7). */
export async function applyEnvironment(env: JsimEnvironment, fileName: string | null, opts: { keepPlan?: boolean } = {}) {
  const fleet = getFleet()!;
  applying = true;
  try {
    w().planner?.active && w().planner.exit();
    // 3. dropzone
    let dzName = w().selectedDropzone?.name ?? "";
    if (env.dropzone) {
      const r = await selectDropzoneByRef(env.dropzone);
      dzName = r.name;
      if (r.matched === "new") notificationManager.warning(`${env.dropzone.name} isn't in the dropzone list; loaded at its saved location.`);
    }
    // 4. plan: the file's own, never written to the dropzone
    if (!opts.keepPlan && env.plan) {
      if (fileName) setPlanSource({ file: fileName });
      if (!useFilePlan(env.plan, dzName)) notificationManager.warning("The file's dropzone plan couldn't be read; using the dropzone's plan.");
    }
    // 5. settings, planes, jumpers, formations
    setJumpSettings(env.jump, { recalc: false });
    const lead = fleet.lead as any;
    lead.linkedFormation = env.load.linkedFormation;
    lead.roundSettings = { ...env.load.roundSettings };
    lead.flockSettings = { ...env.load.flockSettings };
    lead.minDeploySeparationM = env.load.minDeploySeparationM;
    fleet.exitIntervalS = env.load.exitIntervalS;
    fleet.layout = env.load.fleet.layout;
    fleet.spacing = { ...env.load.fleet.spacing };
    const planeById = new Map<string, SimPlane>();
    const planes = env.load.fleet.planes.map((p, k) => {
      const plane = k === 0 ? fleet.lead : fleet.createPlane(p.aircraft, p.label);
      plane.label = p.label;
      plane.floaters = p.floaters;
      plane.goOffsetS = p.goOffsetS;
      planeById.set(p.id, plane);
      return plane;
    });
    fleet.setPlanes(planes);
    if (fleet.lead.aircraftId !== env.load.fleet.planes[0].aircraft) fleet.setAircraft(fleet.lead, env.load.fleet.planes[0].aircraft);
    const jumperById = new Map<string, SimJumper>();
    const jumpers = env.load.jumpers.map((d, k) => {
      const plane = planeById.get(d.plane) ?? fleet.lead;
      const j = new SimJumper(k, plane, 0, 7, d.canopySqft) as any;
      j.weight = d.weightKg;
      j.extraWeight = d.extraWeightKg;
      j.suitType = d.suit;
      j.setBodyPosition(d.position);
      j.tracking = d.tracking;
      j.pullAltitudeFt = d.pullFt;
      j.linked = d.linked;
      if (d.name) j.name = d.name;
      if (d.color) j.color = d.color;
      if (d.laneIndex !== null) j.laneIndex = d.laneIndex;
      if (d.freefallPatternId) j.freefallPatternId = d.freefallPatternId;
      if (d.formationSlot !== null) j.formationSlot = d.formationSlot;
      j.exitOrder = d.exitOrder;
      j.initialExit = d.initialExit;
      j.wantsFloat = d.wantsFloat;
      j.inExitPiece = d.inExitPiece;
      jumperById.set(d.id, j);
      return j as SimJumper;
    });
    // load order: plane order, then exit order
    let idx = 0;
    planes.forEach((p) =>
      jumpers
        .filter((j) => j.plane === p)
        .sort((a, b) => a.exitOrder - b.exitOrder)
        .forEach((j) => (j.index = idx++)),
    );
    const formations = env.load.formations.map(
      (f) =>
        new FormationSequence({
          id: f.id,
          title: f.title,
          points: f.points,
          members: f.members.map((id) => (id ? jumperById.get(id) ?? null : null)),
          settings: f.settings,
          source: f.source,
        }),
    );
    // 6. weather
    if (env.weather.mode === "saved" && env.weather.state) weatherService.pin(env.weather.state, fileName ?? "session", env.weather.override);
    else if (weatherService.pinnedLabel) weatherService.unpin();
    replaceLoad({ jumpers: [...jumpers].sort((a, b) => a.index - b.index), formations });
    // 7. view
    if (env.view) {
      w().playbackSpeed = env.view.speed;
      const sp = document.getElementById("playback-speed") as HTMLSelectElement | null;
      if (sp) sp.value = String(env.view.speed);
      requestAnimationFrame(() => w().updateScrubber?.(env.view!.time));
      const cam = w().simulationCamera as THREE.PerspectiveCamera | undefined;
      const controls = w().simulationControls;
      if (env.view.camera && cam && controls) {
        w().cameraFollow?.stop?.();
        cam.position.fromArray(env.view.camera.position);
        controls.target.fromArray(env.view.camera.target);
        controls.update();
      }
    }
  } finally {
    applying = false;
  }
}

// ---------------------------------------------------------------- open file + unsaved

function renderTitle() {
  const el = document.getElementById("file-title");
  if (!el) return;
  const name = currentFile?.name ?? (getJumpSettings().name !== DEFAULT_JUMP_NAME ? getJumpSettings().name : "");
  el.textContent = name ? `${name}${unsaved ? " •" : ""}` : unsaved ? "Untitled •" : "";
  el.title = currentFile ? `${currentFile.name}${unsaved ? " (unsaved changes)" : ""}` : "No file open";
  const close = document.getElementById("file-close");
  close?.classList.toggle("is-disabled", !currentFile);
}

/** Something in the environment changed: the file has unsaved changes; Auto-Save soon. */
export function markEnvironmentChanged() {
  if (applying) return;
  unsaved = true;
  renderTitle();
  scheduleAutosave();
}

function markSaved() {
  unsaved = false;
  store.set(LAST_SAVE_KEY, String(Date.now()));
  renderTitle();
}

/** Save / Don't save / Cancel (§12.5). */
function askUnsaved(name: string): Promise<"save" | "discard" | "cancel"> {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "jsim-dialog-back";
    back.innerHTML = `
      <div class="jsim-dialog" role="dialog" aria-modal="true" aria-labelledby="jsim-dialog-title">
        <h3 id="jsim-dialog-title"></h3>
        <p>Your changes will be lost if you don't save them.</p>
        <div class="jsim-dialog-actions">
          <button type="button" data-a="save" class="primary">Save</button>
          <button type="button" data-a="discard">Don't save</button>
          <button type="button" data-a="cancel">Cancel</button>
        </div>
      </div>`;
    (back.querySelector("#jsim-dialog-title") as HTMLElement).textContent = `Save changes to ${name}?`;
    const done = (a: "save" | "discard" | "cancel") => {
      back.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(a);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done("cancel");
      }
    };
    back.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => b.addEventListener("click", () => done(b.dataset.a as any)));
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(back);
    back.querySelector<HTMLButtonElement>("[data-a=save]")?.focus();
  });
}

/** Ready to leave the open file? Asks when there are unsaved changes. */
async function confirmLeave(): Promise<boolean> {
  if (!currentFile || !unsaved) return true;
  const a = await askUnsaved(currentFile.name);
  if (a === "cancel") return false;
  if (a === "save") return await save(false);
  return true;
}

// ---------------------------------------------------------------- save

function applyPendingEdits() {
  const pl = w().simPlane?.planeLoad;
  if (pl?.dirty) pl.save?.();
}

async function writeText(text: string, suggested: string, asNew: boolean): Promise<OpenFile | null> {
  const picker = w().showSaveFilePicker;
  if (!asNew && currentFile?.handle) {
    const writable = await currentFile.handle.createWritable();
    await writable.write(text);
    await writable.close();
    return currentFile;
  }
  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: suggested,
        types: [{ description: "JumperSim file", accept: { "application/json": [".jsim"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return { name: handle.name ?? suggested, handle };
    } catch (e: any) {
      if (e?.name === "AbortError") return null; // cancelled
      throw e;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = suggested;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { name: suggested, handle: null };
}

function suggestedName(): string {
  if (currentFile) return currentFile.name;
  const name = getJumpSettings().name;
  const f = getFleet()?.formations[0];
  return jsimFileName(name === DEFAULT_JUMP_NAME && f ? f.title : name);
}

/** File → Save (or Save As). Resolves true when written. */
export async function save(asNew = false): Promise<boolean> {
  try {
    applyPendingEdits();
    await new Promise((r) => queueMicrotask(() => r(null)));
    const text = serializeJsim(collectEnvironment());
    const file = await writeText(text, asNew || !currentFile ? suggestedName() : currentFile.name, asNew);
    if (!file) return false;
    const wasOpen = !!currentFile;
    currentFile = file;
    if (!wasOpen || getPlanSource() === "dropzone") setPlanSource({ file: file.name });
    markSaved();
    notificationManager.success(`Saved ${file.name}`, { duration: 3000 });
    return true;
  } catch (e) {
    console.error("Save failed", e);
    notificationManager.error("Couldn't save the file.");
    return false;
  }
}

// ---------------------------------------------------------------- load

interface LoadUndo {
  fleetEnv: ReturnType<typeof captureEnvironment>;
  jump: ReturnType<typeof getJumpSettings>;
  file: OpenFile | null;
  unsaved: boolean;
  planSource: ReturnType<typeof getPlanSource>;
  planJSON: string;
  dropzone: any;
  weatherPinned: boolean;
}

/** Load a .jsim file's text (§12.5). */
export async function loadJsimText(text: string, name: string) {
  let parsed: ReturnType<typeof parseJsim>;
  try {
    parsed = parseJsim(text);
  } catch (e) {
    notificationManager.error(e instanceof JsimError ? e.message : "Couldn't read that .jsim file.");
    if (!(e instanceof JsimError)) console.error(e);
    return;
  }
  if (!(await confirmLeave())) return;
  const fleet = getFleet()!;
  const undo: LoadUndo = {
    fleetEnv: captureEnvironment(fleet),
    jump: { ...getJumpSettings() },
    file: currentFile,
    unsaved,
    planSource: getPlanSource(),
    planJSON: JSON.stringify(getDropzonePlan()),
    dropzone: w().selectedDropzone,
    weatherPinned: !!weatherService.pinnedLabel,
  };
  const { env, warnings } = parsed;
  await applyEnvironment(env, name);
  currentFile = { name, handle: null };
  markSaved();
  const planes = env.load.fleet.planes.length;
  const n = env.load.jumpers.length;
  const notes = [...warnings];
  if (env.appVersion && env.appVersion !== (pkg as any).version) notes.push(`Saved with JumperSim ${env.appVersion}: tracks may differ slightly`);
  notificationManager.success(
    `Loaded ${name} · ${planes} plane${planes > 1 ? "s" : ""}, ${n} jumper${n === 1 ? "" : "s"} · ${env.weather.mode === "saved" ? "weather from file" : "live weather"}` +
      (notes.length ? ` · ⚠ ${notes.join(". ")}.` : ""),
    {
      duration: notes.length ? 12000 : 8000,
      actions: [
        { label: "Undo", callback: () => void undoLoad(undo) },
        ...(env.weather.mode === "saved"
          ? [{ label: "Use live weather", callback: () => weatherService.unpin() }]
          : []),
      ],
    },
  );
}

async function undoLoad(u: LoadUndo) {
  const fleet = getFleet()!;
  applying = true;
  try {
    if (u.dropzone && u.dropzone !== w().selectedDropzone) await selectDropzoneByRef(u.dropzone);
    setPlanSource(u.planSource);
    if (u.planSource === "dropzone") loadPlanForDropzone(w().selectedDropzone);
    else useFilePlan(JSON.parse(u.planJSON), w().selectedDropzone?.name ?? "");
    setJumpSettings(u.jump, { recalc: false });
    if (!u.weatherPinned && weatherService.pinnedLabel) weatherService.unpin();
    restoreEnvironment(fleet, u.fleetEnv);
  } finally {
    applying = false;
  }
  currentFile = u.file;
  unsaved = u.unsaved;
  renderTitle();
}

function pickAndLoad() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".jsim,application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file) await loadJsimText(await file.text(), file.name);
  };
  input.click();
}

// ---------------------------------------------------------------- close

/** File → Close: the dropzone's own plan comes back; the rest stays, untitled (§12.5). */
export async function closeFile(): Promise<boolean> {
  if (!currentFile) return true;
  if (!(await confirmLeave())) return false;
  detachFile();
  loadPlanForDropzone(w().selectedDropzone);
  requestRecalculation();
  return true;
}

function detachFile() {
  currentFile = null;
  setPlanSource("dropzone");
  unsaved = false;
  renderTitle();
}

/** Use as dropzone plan: the only way a file's plan reaches the dropzone. */
export function useFilePlanForDropzone() {
  const dz = getDropzonePlan().dropzone;
  if (!dz) return;
  if (!window.confirm(`Replace ${dz}'s saved plan with the plan from ${currentFile?.name ?? "this file"}?`)) return;
  const before = savedDropzonePlanJSON(dz);
  if (!saveActivePlanToDropzone()) {
    notificationManager.error("Couldn't save the dropzone plan (storage full or blocked).");
    return;
  }
  notificationManager.success(`${dz} now uses this plan.`, {
    actions: [{ label: "Undo", callback: () => restoreSavedDropzonePlanJSON(dz, before) }],
  });
}

// ---------------------------------------------------------------- auto-save

function autosaveOn() {
  return store.get(AUTOSAVE_ON_KEY) === "1";
}

function scheduleAutosave() {
  if (!autosaveOn()) return;
  if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    try {
      const payload = JSON.stringify({ savedAt: Date.now(), file: currentFile?.name ?? null, text: serializeJsim(collectEnvironment()) });
      if (!store.set(AUTOSAVE_KEY, payload)) throw new Error("storage");
    } catch {
      store.set(AUTOSAVE_ON_KEY, "0");
      syncAutosaveBox();
      notificationManager.warning("Auto-Save turned off: the browser's storage is full.");
    }
  }, 2000);
}

function syncAutosaveBox() {
  const box = document.querySelector<HTMLInputElement>("#file-autosave input");
  if (box) box.checked = autosaveOn();
  document.getElementById("file-autosave")?.setAttribute("aria-checked", String(autosaveOn()));
}

function offerRestore() {
  if (!autosaveOn()) return;
  const raw = store.get(AUTOSAVE_KEY);
  if (!raw) return;
  let saved: { savedAt: number; file: string | null; text: string };
  try {
    saved = JSON.parse(raw);
  } catch {
    return;
  }
  const last = Number(store.get(LAST_SAVE_KEY)) || 0;
  if (!saved?.text || !(saved.savedAt > last)) return;
  notificationManager.info(`Auto-saved session from ${new Date(saved.savedAt).toLocaleString()}${saved.file ? ` (${saved.file})` : ""}.`, {
    duration: 0,
    actions: [
      {
        label: "Restore last session",
        callback: async () => {
          let env: JsimEnvironment;
          try {
            env = parseJsim(saved.text).env;
          } catch {
            notificationManager.error("The auto-saved session couldn't be read.");
            return;
          }
          // without an open file the plan was the dropzone's own: keep it
          await applyEnvironment(env, saved.file, { keepPlan: !saved.file });
          currentFile = saved.file ? { name: saved.file, handle: null } : null;
          unsaved = !!saved.file;
          renderTitle();
        },
      },
      { label: "Dismiss", callback: () => store.set(LAST_SAVE_KEY, String(Date.now())) },
    ],
  });
}

// ---------------------------------------------------------------- wiring

export function initializeFileMenu() {
  const on = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener("click", fn);
  on("file-save", () => void save(false));
  on("file-save-as", () => void save(true));
  on("file-load", pickAndLoad);
  on("file-close", () => void closeFile());
  on("formation-save", () => void save(false));
  const auto = document.getElementById("file-autosave");
  auto?.addEventListener("click", (e) => {
    e.stopPropagation();
    store.set(AUTOSAVE_ON_KEY, autosaveOn() ? "0" : "1");
    syncAutosaveBox();
    if (autosaveOn()) scheduleAutosave();
  });
  syncAutosaveBox();

  document.addEventListener(
    "keydown",
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void save(e.shiftKey);
      } else if (k === "o" && !e.shiftKey) {
        e.preventDefault();
        pickAndLoad();
      }
    },
    true,
  );

  // drop a .jsim (load) or .jump (import) anywhere on the window
  window.addEventListener("dragover", (e) => {
    if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file")) e.preventDefault();
  });
  window.addEventListener("drop", async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    if (/\.jsim$/i.test(file.name)) await loadJsimText(await file.text(), file.name);
    else if (/\.jump$/i.test(file.name)) importJumpText(await file.text(), file.name);
  });

  // switching dropzone closes the file: its plan belongs to its own dropzone
  setDropzoneChangeGuard(async () => {
    if (!currentFile) return true;
    if (!(await confirmLeave())) return false;
    detachFile();
    return true;
  });

  // what counts as a change (plan edits, Plane Settings edits and imports send "environment-changed")
  onJumpSettingsChanged(() => markEnvironmentChanged());
  getFleet()?.onChange(() => markEnvironmentChanged());
  window.addEventListener("environment-changed", () => markEnvironmentChanged());
  window.addEventListener("beforeunload", (e) => {
    if (currentFile && unsaved) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  w().fileMenu = { save, closeFile, loadJsimText, collectEnvironment, useFilePlanForDropzone, get currentFile() { return currentFile; } };
  renderTitle();
  setTimeout(offerRestore, 4000);
}
