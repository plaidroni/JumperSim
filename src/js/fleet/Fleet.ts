// Several aircraft flying jumprun in formation (specs/formation-jumps.md §5.2–5.3).
// planes[0] is the lead: it flies the dropzone plan's jumprun at the exit altitude;
// trail planes fly the same heading and speed at an offset in the lead's frame.

import * as THREE from "three";
import { SimPlane, type SimJumper } from "../classes/SimEntities";
import type { FormationSequence } from "../formations/FormationSequence";
import { AIRCRAFT, AircraftId, aircraft } from "./Aircraft";

export type FleetLayoutId = "v" | "echelon-right" | "echelon-left" | "trail";
export const FLEET_LAYOUTS: Record<FleetLayoutId, string> = {
  v: "V",
  "echelon-right": "Echelon right",
  "echelon-left": "Echelon left",
  trail: "Trail",
};
export const FLEET_LAYOUT_ORDER: FleetLayoutId[] = ["v", "echelon-right", "echelon-left", "trail"];

export interface PlaneOffset {
  backM: number;
  rightM: number;
  upM: number;
}

export interface FleetSpacing {
  /** Per row, metres. */
  backM: number;
  rightM: number;
  upM: number;
}

export const DEFAULT_SPACING: FleetSpacing = { backM: 30, rightM: 40, upM: 30 };
export const MAX_PLANES = 10;
const PLANE_COLORS = [0xff0066, 0x3cb44b, 0x4363d8, 0xf58231, 0x911eb4, 0x46f0f0, 0xf032e6, 0xbcf60c, 0xfabebe, 0x008080];

/** Offset of plane k (k ≥ 1) for a layout. */
export function layoutOffset(layout: FleetLayoutId, k: number, s: FleetSpacing = DEFAULT_SPACING): PlaneOffset {
  if (k <= 0) return { backM: 0, rightM: 0, upM: 0 };
  switch (layout) {
    case "echelon-right":
      return { backM: s.backM * k, rightM: s.rightM * k, upM: s.upM * k };
    case "echelon-left":
      return { backM: s.backM * k, rightM: -s.rightM * k, upM: s.upM * k };
    case "trail":
      return { backM: 2 * s.backM * k, rightM: 0, upM: s.upM * k };
    case "v":
    default: {
      const r = Math.ceil(k / 2);
      const side = k % 2 === 1 ? 1 : -1;
      return { backM: s.backM * r, rightM: side * s.rightM * r, upM: s.upM * r };
    }
  }
}

type Listener = () => void;

export class Fleet {
  planes: SimPlane[];
  layout: FleetLayoutId = "v";
  spacing: FleetSpacing = { ...DEFAULT_SPACING };
  /** Seconds between exit groups on each plane (Plane Settings "Exit interval"). */
  exitIntervalS = 10;
  private _formations: FormationSequence[] = [];
  private listeners = new Set<Listener>();
  /** Creates a model for a plane (set by PlaneSelect so this file stays DOM/GLTF free). */
  modelLoader: ((plane: SimPlane) => void) | null = null;

  constructor(lead: SimPlane) {
    this.planes = [lead];
    this.prepare(lead, 0);
  }

  get lead(): SimPlane {
    return this.planes[0];
  }

  get formations(): FormationSequence[] {
    return this._formations;
  }

  /** Imported formations; every plane shares the same list (formations span planes). */
  set formations(list: FormationSequence[]) {
    this._formations = list;
    this.planes.forEach((p) => (p.formations = list));
  }

  onChange(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error("fleet listener failed", e);
      }
    });
  }

  private prepare(p: SimPlane, k: number) {
    if (!p.label) p.label = k === 0 ? "Lead" : `Plane ${k + 1}`;
    if (!p.planeColor) p.planeColor = PLANE_COLORS[this.planes.indexOf(p) % PLANE_COLORS.length] ?? PLANE_COLORS[k % PLANE_COLORS.length];
    p.formations = this._formations;
  }

  /** Add a plane of an aircraft type, placed by the layout. */
  addPlane(aircraftId: AircraftId = this.lead.aircraftId, label?: string): SimPlane {
    if (this.planes.length >= MAX_PLANES) throw new Error(`At most ${MAX_PLANES} planes.`);
    const lead = this.lead;
    const p = new SimPlane(lead.initialPosition.clone(), lead.getSpeedKnots(), lead.direction.clone());
    p.aircraftId = aircraftId;
    p.label = label ?? `Plane ${this.planes.length + 1}`;
    p.planeColor = PLANE_COLORS[this.planes.length % PLANE_COLORS.length];
    p.linkedFormation = lead.linkedFormation;
    (p as any).roundSettings = (lead as any).roundSettings;
    (p as any).flockSettings = (lead as any).flockSettings;
    (p as any).minDeploySeparationM = (lead as any).minDeploySeparationM;
    p.planeLoad = lead.planeLoad;
    this.planes.push(p);
    this.prepare(p, this.planes.length - 1);
    this.applyLayout();
    this.modelLoader?.(p);
    this.emit();
    return p;
  }

  /** Remove a plane; its jumpers move to `moveTo` (or are returned to the caller to place). */
  removePlane(plane: SimPlane, moveTo?: SimPlane): SimJumper[] {
    if (this.planes.length <= 1 || !this.planes.includes(plane)) return [];
    const aboard = this.jumpersOf(plane);
    this.planes = this.planes.filter((p) => p !== plane);
    plane.getMesh()?.removeFromParent();
    if (moveTo) aboard.forEach((j) => this.moveJumper(j, moveTo));
    this.applyLayout();
    this.emit();
    return aboard;
  }

  setLead(plane: SimPlane) {
    const i = this.planes.indexOf(plane);
    if (i <= 0) return;
    const old = this.lead;
    // the new lead takes the old lead's place on jumprun
    plane.initialPosition.copy(old.initialPosition);
    plane.direction.copy(old.direction);
    this.planes.splice(i, 1);
    this.planes.unshift(plane);
    this.applyLayout();
    this.emit();
  }

  movePlane(plane: SimPlane, delta: number) {
    const i = this.planes.indexOf(plane);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.planes.length) return;
    if (j === 0 || i === 0) {
      this.setLead(i === 0 ? this.planes[1] : plane);
      return;
    }
    [this.planes[i], this.planes[j]] = [this.planes[j], this.planes[i]];
    this.applyLayout();
    this.emit();
  }

  setAircraft(plane: SimPlane, id: AircraftId) {
    plane.aircraftId = id;
    this.modelLoader?.(plane);
    this.emit();
  }

  setLayout(layout: FleetLayoutId) {
    this.layout = layout;
    this.applyLayout();
    this.emit();
  }

  /** Offsets from the layout and spacing (the lead is 0,0,0). */
  applyLayout() {
    this.planes.forEach((p, k) => (p.offset = layoutOffset(this.layout, k, this.spacing)));
  }

  /** Trail planes: lead position + offset (in the lead's frame), same heading and speed. */
  syncFromLead() {
    const lead = this.lead;
    lead.offset = { backM: 0, rightM: 0, upM: 0 };
    const fwd = new THREE.Vector3(lead.direction.x, 0, lead.direction.z);
    if (fwd.lengthSq() < 1e-9) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    for (const p of this.planes) {
      if (p === lead) continue;
      const o = p.offset;
      p.initialPosition
        .copy(lead.initialPosition)
        .addScaledVector(right, o.rightM)
        .addScaledVector(fwd, -o.backM)
        .add(new THREE.Vector3(0, o.upM, 0));
      p.position.copy(p.initialPosition);
      p.direction.copy(lead.direction);
      p.setSpeedKnots(lead.getSpeedKnots());
      p.linkedFormation = lead.linkedFormation;
      (p as any).roundSettings = (lead as any).roundSettings;
      (p as any).flockSettings = (lead as any).flockSettings;
      (p as any).minDeploySeparationM = (lead as any).minDeploySeparationM;
    }
  }

  /** Jumpers aboard a plane, in exit order. */
  jumpersOf(plane: SimPlane, all: SimJumper[] = allLoad()): SimJumper[] {
    return all.filter((j) => j.plane === plane).sort((a, b) => a.exitOrder - b.exitOrder || a.index - b.index);
  }

  /** Move a jumper to a plane, last in its exit order unless given. */
  moveJumper(j: SimJumper, to: SimPlane, exitOrder?: number) {
    const from = j.plane as SimPlane;
    const others = this.jumpersOf(to).filter((x) => x !== j);
    j.plane = to;
    j.direction = to.direction;
    j.initialVelocity = to.vector;
    const at = exitOrder === undefined ? others.length : Math.max(0, Math.min(others.length, exitOrder));
    others.splice(at, 0, j);
    others.forEach((x, k) => (x.exitOrder = k));
    if (from && from !== to) this.jumpersOf(from).forEach((x, k) => (x.exitOrder = k));
  }

  /** Global load order: plane order, then exit order. */
  reindex(all: SimJumper[] = allLoad()) {
    let k = 0;
    for (const p of this.planes) this.jumpersOf(p, all).forEach((j) => (j.index = k++));
    // anyone on a plane that's gone goes to the lead
    all.filter((j) => !this.planes.includes(j.plane as SimPlane)).forEach((j) => {
      this.moveJumper(j, this.lead);
      j.index = k++;
    });
  }

  /** Seats used / capacity per plane. */
  seats(plane: SimPlane, all: SimJumper[] = allLoad()) {
    const used = all.filter((j) => j.plane === plane).length;
    return { used, capacity: aircraft(plane.aircraftId).capacity, over: (aircraft(plane.aircraftId).capacity ?? Infinity) < used };
  }

  /** Planes too close: within a wingspan sideways and a length fore-aft. */
  overlaps(): [SimPlane, SimPlane][] {
    const out: [SimPlane, SimPlane][] = [];
    for (let a = 0; a < this.planes.length; a++)
      for (let b = a + 1; b < this.planes.length; b++) {
        const pa = this.planes[a], pb = this.planes[b];
        const span = Math.max(AIRCRAFT[pa.aircraftId].wingspanM, AIRCRAFT[pb.aircraftId].wingspanM);
        const len = Math.max(AIRCRAFT[pa.aircraftId].lengthM, AIRCRAFT[pb.aircraftId].lengthM);
        if (Math.abs(pa.offset.rightM - pb.offset.rightM) < span && Math.abs(pa.offset.backM - pb.offset.backM) < len)
          out.push([pa, pb]);
      }
    return out;
  }

  /** Highest exit altitude (m) over all planes. */
  highestExitM() {
    return Math.max(...this.planes.map((p) => p.initialPosition.y));
  }
}

function allLoad(): SimJumper[] {
  const w = typeof window !== "undefined" ? (window as any) : {};
  return Array.isArray(w.simJumpers) ? w.simJumpers : [];
}

/** The app's fleet (Scripts.ts creates it). */
export function getFleet(): Fleet | null {
  return (typeof window !== "undefined" && (window as any).fleet) || null;
}
