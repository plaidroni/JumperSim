import type { EN } from "./geometry";
import { requestRecalculation } from "../core/data/SimulationVariables";

/**
 * The dropzone plan: jumprun, landing zones, danger zones, the canopy landing pattern
 * and freefall patterns. One plan per dropzone, saved in localStorage, exportable as
 * JSON. Every committed edit recalculates the sim (debounced).
 */

export interface Jumprun {
  start: EN;
  /** Degrees true. */
  headingDeg: number;
  mode: "fixed" | "intoUpperWind";
}

export interface LandingZone {
  id: string;
  name: string;
  polygon: EN[];
  /** Old plans only (before touchdown moved to the pattern); ignored. */
  primary?: boolean;
  target?: EN;
  spreadM?: number;
}

export type DangerKind =
  | "runway"
  | "powerlines"
  | "wash"
  | "road"
  | "water"
  | "buildings"
  | "trees"
  | "other";

export type DangerShape =
  | { type: "polygon"; points: EN[] }
  | { type: "line"; points: EN[]; widthM: number };

export interface DangerZone {
  id: string;
  name: string;
  kind: DangerKind;
  shape: DangerShape;
  ceilingFt: number;
  notes?: string;
}

export interface CanopyPattern {
  /** Downwind start, turn to base, turn to final, touchdown — all picked by the user. */
  points: [EN, EN, EN, EN];
  /** Jumpers' touchdown points are spread this far around the picked touchdown (m). */
  spreadM: number;
  /** Downwind, base, final start altitudes (ft AGL). */
  legAltitudesFt: [number, number, number];
  orientation: "flip" | "fixed";
  calmThresholdKt: number;
}

export type LegEnd = { by: "altitude"; ft: number } | { by: "arrival" } | { by: "time"; s: number };

export interface FreefallLeg {
  /** Map anchor: metres E/N of the DZ. Jumprun anchor: e = along jumprun, n = left of it. */
  point: EN;
  steer: "point" | "heading";
  headingDeg?: number;
  end: LegEnd;
}

export interface FreefallPattern {
  id: string;
  name: string;
  kind: "tracking" | "wingsuit";
  isDefault: boolean;
  anchor: "jumprun" | "map";
  legs: FreefallLeg[];
  deployRadiusM: number;
  laneSpacingM: number;
}

export interface DropzonePlan {
  version: 1;
  dropzone: string;
  jumprun: Jumprun | null;
  landingZones: LandingZone[];
  dangerZones: DangerZone[];
  canopyPattern: CanopyPattern | null;
  freefallPatterns: FreefallPattern[];
}

export const DANGER_KINDS: Record<DangerKind, { label: string; color: number; shape: "polygon" | "rect" | "line"; widthM?: number }> = {
  runway: { label: "Runway", color: 0xff5a4f, shape: "rect" },
  powerlines: { label: "Power lines", color: 0xffb020, shape: "line", widthM: 30 },
  wash: { label: "Wash", color: 0xd08a4a, shape: "polygon" },
  road: { label: "Road", color: 0xff7a59, shape: "line", widthM: 20 },
  water: { label: "Water", color: 0x4f9dff, shape: "polygon" },
  buildings: { label: "Buildings", color: 0xff6d8a, shape: "polygon" },
  trees: { label: "Trees", color: 0x58c46b, shape: "polygon" },
  other: { label: "Other", color: 0xff5a4f, shape: "polygon" },
};

export const DEFAULT_CEILING_FT = 500;
export const DEFAULT_LEG_ALTS: [number, number, number] = [1000, 500, 250];

export function emptyPlan(dropzone = ""): DropzonePlan {
  return {
    version: 1,
    dropzone,
    jumprun: null,
    landingZones: [],
    dangerZones: [],
    canopyPattern: null,
    freefallPatterns: [],
  };
}

export function newId(prefix = "id"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

// ------------------------------------------------------------------ state

let plan: DropzonePlan = emptyPlan();
let version = 0;

/** Increments on every change (used to cache derived data). */
export function getPlanVersion() {
  return version;
}
const listeners = new Set<(p: DropzonePlan, live: boolean) => void>();
const undoStack: string[] = [];
const redoStack: string[] = [];
let saveTimer: any = null;
let recalcTimer: any = null;

const storageKey = (dz: string) => `jumpersim.dzplan.${dz}`;
const hasStorage = () => typeof localStorage !== "undefined";

export function getDropzonePlan(): DropzonePlan {
  return plan;
}

/** Subscribe to plan changes. `live` is true while a drag is in progress. */
export function onPlanChanged(cb: (p: DropzonePlan, live: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(live: boolean) {
  version++;
  listeners.forEach((cb) => {
    try {
      cb(plan, live);
    } catch (e) {
      console.error("plan listener failed", e);
    }
  });
}

function scheduleSaveAndRecalc() {
  if (hasStorage() && plan.dropzone) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey(plan.dropzone), JSON.stringify(plan));
      } catch {
        /* storage full or blocked */
      }
    }, 500);
  }
  clearTimeout(recalcTimer);
  recalcTimer = setTimeout(() => requestRecalculation(), 300);
}

/** Replace the plan without undo/save/recalc (tests, loading). */
export function setDropzonePlan(p: DropzonePlan) {
  plan = p;
  emit(false);
}

/**
 * Change the plan. With `live` (mid-drag) listeners redraw but nothing is saved,
 * pushed to undo or recalculated; the final call of a drag passes live = false.
 */
export function updatePlan(mutate: (p: DropzonePlan) => void, opts: { live?: boolean; snapshot?: string } = {}) {
  if (!opts.live) pushUndo(opts.snapshot ?? JSON.stringify(plan));
  mutate(plan);
  emit(!!opts.live);
  if (!opts.live) scheduleSaveAndRecalc();
}

/** JSON of the plan now, to pass as `snapshot` when a drag that started earlier ends. */
export function snapshotPlan(): string {
  return JSON.stringify(plan);
}

function pushUndo(snapshot = JSON.stringify(plan)) {
  if (undoStack[undoStack.length - 1] === snapshot) return;
  undoStack.push(snapshot);
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}

export function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(JSON.stringify(plan));
  plan = JSON.parse(prev);
  emit(false);
  scheduleSaveAndRecalc();
}

export function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(JSON.stringify(plan));
  plan = JSON.parse(next);
  emit(false);
  scheduleSaveAndRecalc();
}

/** Load the saved plan for a dropzone, else its default from dropzones.json, else empty. */
export function loadPlanForDropzone(dz: { name: string; plan?: DropzonePlan }) {
  let loaded: DropzonePlan | null = null;
  if (hasStorage()) {
    try {
      const raw = localStorage.getItem(storageKey(dz.name));
      if (raw) loaded = validatePlan(JSON.parse(raw));
    } catch {
      loaded = null;
    }
  }
  if (!loaded && dz.plan) loaded = validatePlan(JSON.parse(JSON.stringify(dz.plan)));
  plan = loaded ?? emptyPlan(dz.name);
  plan.dropzone = dz.name;
  undoStack.length = 0;
  redoStack.length = 0;
  emit(false);
  requestRecalculation();
}

export function resetPlanToDefault(dz: { name: string; plan?: DropzonePlan }) {
  updatePlan((p) => {
    const def = dz.plan ? validatePlan(JSON.parse(JSON.stringify(dz.plan))) : null;
    Object.assign(p, def ?? emptyPlan(dz.name));
    p.dropzone = dz.name;
  });
}

export function exportPlanJSON(): string {
  return JSON.stringify(plan, null, 2);
}

/** Import a plan file. Returns a warning when it was made for another dropzone. */
export function importPlanJSON(text: string): string | null {
  const parsed = validatePlan(JSON.parse(text));
  if (!parsed) throw new Error("Not a JumperSim dropzone plan (version 1).");
  const warning =
    plan.dropzone && parsed.dropzone && parsed.dropzone !== plan.dropzone
      ? `This plan was made for ${parsed.dropzone}.`
      : null;
  updatePlan((p) => {
    const dz = p.dropzone;
    Object.assign(p, parsed);
    p.dropzone = dz || parsed.dropzone;
  });
  return warning;
}

function validatePlan(raw: any): DropzonePlan | null {
  if (!raw || raw.version !== 1) return null;
  const landingZones: LandingZone[] = Array.isArray(raw.landingZones) ? raw.landingZones : [];
  let canopyPattern: any = raw.canopyPattern ?? null;
  if (canopyPattern && Array.isArray(canopyPattern.points) && canopyPattern.points.length === 3) {
    // plans saved before the touchdown was part of the pattern: keep the touchdown the
    // user had placed in their LZ; without one the pattern has to be redrawn
    const old = landingZones.find((z) => z.primary && z.target) ?? landingZones.find((z) => z.target);
    canopyPattern = old?.target
      ? { ...canopyPattern, points: [...canopyPattern.points, old.target] }
      : null;
  }
  if (canopyPattern && typeof canopyPattern.spreadM !== "number")
    canopyPattern = { ...canopyPattern, spreadM: old_spread(landingZones) };
  return {
    version: 1,
    dropzone: String(raw.dropzone ?? ""),
    jumprun: raw.jumprun ?? null,
    landingZones,
    dangerZones: Array.isArray(raw.dangerZones) ? raw.dangerZones : [],
    canopyPattern,
    freefallPatterns: Array.isArray(raw.freefallPatterns) ? raw.freefallPatterns : [],
  };
}

function old_spread(lzs: LandingZone[]): number {
  const s = lzs.find((z) => z.primary)?.spreadM;
  return typeof s === "number" ? s : DEFAULT_SPREAD_M;
}

export const DEFAULT_SPREAD_M = 30;

/** The touchdown point the user picked as the end of the landing pattern. */
export function patternTouchdown(p: DropzonePlan = plan): EN | null {
  return p.canopyPattern?.points[3] ?? null;
}

/** The landing zone the pattern lands in (the one containing its touchdown), if any. */
export function mainLandingZone(p: DropzonePlan = plan): LandingZone | null {
  const t = patternTouchdown(p);
  if (!t) return null;
  return p.landingZones.find((z) => z.polygon.length >= 3 && inPolygonEN(z.polygon, t)) ?? null;
}

/** @deprecated use mainLandingZone */
export const primaryLandingZone = mainLandingZone;

function inPolygonEN(pts: EN[], p: EN): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.n > p.n !== b.n > p.n && p.e < ((b.e - a.e) * (p.n - a.n)) / (b.n - a.n) + a.e) inside = !inside;
  }
  return inside;
}

/**
 * Reference point for jumprun offsets and the planner view: the picked touchdown, else
 * the middle of the first landing zone, else the DZ origin. Never used as a landing spot.
 */
export function planReferencePoint(p: DropzonePlan = plan): EN {
  const t = patternTouchdown(p);
  if (t) return t;
  const lz = p.landingZones.find((z) => z.polygon.length >= 3);
  if (!lz) return { e: 0, n: 0 };
  const e = lz.polygon.reduce((s, q) => s + q.e, 0) / lz.polygon.length;
  const n = lz.polygon.reduce((s, q) => s + q.n, 0) / lz.polygon.length;
  return { e, n };
}

export function defaultFreefallPattern(kind: "tracking" | "wingsuit", p: DropzonePlan = plan) {
  const ofKind = p.freefallPatterns.filter((f) => f.kind === kind);
  return ofKind.find((f) => f.isDefault) ?? ofKind[0] ?? null;
}
