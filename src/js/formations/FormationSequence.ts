// A multi-point formation from a .jump file (specs/formation-jumps.md §8).
// Replaces the old classes/Formations.ts `Formation`.

import * as THREE from "three";
import type { SimJumper } from "../classes/SimEntities";
import type { ParsedJump, ParsedPoint } from "./JumpFile";
import { DEFAULT_ROUND_SETTINGS } from "../physics/FormationShapes";
import { headingQuaternion } from "../physics/Canopy";

export interface SequenceSettings {
  /** Window for every point after the first (s). */
  timePerPointS: number;
  /** Window for point 1; "auto" = see §8.3. */
  firstPointS: number | "auto";
  advance: "timed" | "early";
  /** A point must stay complete this long to score. */
  minHoldS: number;
  /** Scoring window from the first exit; "auto" = until breakoff. */
  workingTimeS: number | "auto";
  /** Cycle the points until working time / breakoff. */
  repeat: boolean;
  /** Page-up relative to jumprun forward (degrees, clockwise). */
  orientationDeg: number;
  /** Jumpers who leave the lead already gripped; "auto" = the lead's initial exit (§6.3). */
  exitPieceSize: number | "auto";
  /** Breakoff altitude, ft above the DZ. */
  breakoffFt: number;
}

export const DEFAULT_SEQUENCE_SETTINGS: SequenceSettings = {
  timePerPointS: 6,
  firstPointS: "auto",
  advance: "timed",
  minHoldS: 1,
  workingTimeS: "auto",
  repeat: true,
  orientationDeg: 0,
  exitPieceSize: "auto",
  breakoffFt: DEFAULT_ROUND_SETTINGS.breakoffFt,
};

export type MissReason = { kind: "late" | "low" | "far" | "fallRate"; detail: string };

export interface SequenceWindow {
  point: number;
  round: number;
  start: number;
  end: number;
  keyedAt: number | null;
  scored: boolean;
  missingSlots: number[];
}

export interface SequenceResult {
  tGo: number;
  workingTimeEnd: number;
  breakoffTime: number;
  windows: SequenceWindow[];
  score: number;
  members: { slot: number; dockTimes: (number | null)[]; missed: MissReason | null }[];
}

let nextId = 1;

export class FormationSequence {
  id: string;
  title: string;
  points: ParsedPoint[];
  /** members[i] flies slot i in every point (null = empty slot). */
  members: (SimJumper | null)[];
  settings: SequenceSettings;
  source: { file: string; docVersion: number };
  result: SequenceResult | null = null;

  constructor(opts: {
    id?: string;
    title: string;
    points: ParsedPoint[];
    members: (SimJumper | null)[];
    settings?: Partial<SequenceSettings>;
    source?: { file: string; docVersion: number };
  }) {
    this.id = opts.id ?? `f${Date.now().toString(36)}${(nextId++).toString(36)}`;
    this.title = opts.title;
    this.points = opts.points;
    this.members = opts.members;
    this.settings = sanitizeSequenceSettings({ ...DEFAULT_SEQUENCE_SETTINGS, ...(opts.settings ?? {}) });
    this.source = opts.source ?? { file: "", docVersion: 2 };
    this.members.forEach((m, i) => m && attach(m, this, i));
  }

  static fromParsed(parsed: ParsedJump, members: (SimJumper | null)[], settings?: Partial<SequenceSettings>) {
    return new FormationSequence({
      title: parsed.title,
      points: parsed.points,
      members,
      settings,
      source: { file: parsed.sourceName, docVersion: parsed.docVersion },
    });
  }

  get slotCount() {
    return this.points[0]?.slots.length ?? 0;
  }

  /** Jumpers in this formation (slot order, empty slots skipped). */
  getAllJumpers(): SimJumper[] {
    return this.members.filter((m): m is SimJumper => !!m);
  }

  slotOf(j: SimJumper): number {
    return this.members.indexOf(j);
  }

  /** Take a jumper out: their slot stays empty. */
  removeMember(j: SimJumper) {
    const i = this.members.indexOf(j);
    if (i < 0) return;
    this.members[i] = null;
    detach(j);
  }

  /** Put a jumper in the first empty slot (false when full). */
  addMember(j: SimJumper): boolean {
    if (this.members.includes(j)) return true;
    const i = this.members.indexOf(null);
    if (i < 0) return false;
    this.members[i] = j;
    attach(j, this, i);
    return true;
  }

  /** Swap who flies slot a and slot b (in every point). */
  swapSlots(a: number, b: number) {
    const ma = this.members[a];
    const mb = this.members[b];
    this.members[a] = mb;
    this.members[b] = ma;
    if (mb) attach(mb, this, a);
    if (ma) attach(ma, this, b);
  }

  /** Formation frame for a jumprun direction: forward and right unit vectors (§8.2). */
  frame(jumprunDir: { x: number; z: number }) {
    const f = new THREE.Vector3(jumprunDir.x, 0, jumprunDir.z);
    if (f.lengthSq() < 1e-9) f.set(0, 0, -1);
    f.normalize();
    if (this.settings.orientationDeg) f.applyAxisAngle(new THREE.Vector3(0, 1, 0), -THREE.MathUtils.degToRad(this.settings.orientationDeg));
    const right = new THREE.Vector3(-f.z, 0, f.x);
    const headingDeg = (THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z)) + 360) % 360;
    return { forward: f, right, headingDeg };
  }

  /** Offset (m, world axes) of slot i in point k from the formation centre. */
  slotOffset(k: number, i: number, frame: ReturnType<FormationSequence["frame"]>, out = new THREE.Vector3()) {
    const s = this.points[k]?.slots[i];
    if (!s) return out.set(0, 0, 0);
    return out.copy(frame.right).multiplyScalar(s.x).addScaledVector(frame.forward, s.y);
  }

  /** Heading (degrees clockwise from north) of slot i in point k. */
  slotHeadingDeg(k: number, i: number, frame: ReturnType<FormationSequence["frame"]>) {
    const s = this.points[k]?.slots[i];
    return (((frame.headingDeg + (s?.headingDeg ?? 0)) % 360) + 360) % 360;
  }

  /** Largest distance from the centre over all points (m). */
  radius(k?: number) {
    const pts = k === undefined ? this.points : [this.points[k]];
    let r = 0;
    pts.forEach((p) => p?.slots.forEach((s) => (r = Math.max(r, Math.hypot(s.x, s.y)))));
    return r;
  }
}

function attach(j: SimJumper, f: FormationSequence, slot: number) {
  (j as any).formation = f;
  (j as any).formationSlot = slot + 1;
  j.isInFormation = true;
  j.linked = true;
}

function detach(j: SimJumper) {
  (j as any).formation = undefined;
  (j as any).formationSlot = undefined;
  j.isInFormation = false;
}

/** The sequence a jumper flies, if any. */
export function sequenceOf(j: SimJumper | null | undefined): FormationSequence | null {
  const f = (j as any)?.formation;
  return f instanceof FormationSequence && f.members.includes(j!) ? f : null;
}

/** Quaternion for a compass heading (degrees clockwise from north; world −Z is north). */
export function headingToQuaternion(headingDeg: number, out = new THREE.Quaternion()) {
  const r = THREE.MathUtils.degToRad(headingDeg);
  return headingQuaternion(new THREE.Vector3(Math.sin(r), 0, -Math.cos(r)), out);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const autoOr = (v: unknown, d: number | "auto", lo: number, hi: number): number | "auto" =>
  v === "auto" ? "auto" : typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : d;

/** Coerce settings from a file or the UI into valid values (no strings reach the DOM). */
export function sanitizeSequenceSettings(raw: any): SequenceSettings {
  const d = DEFAULT_SEQUENCE_SETTINGS;
  return {
    timePerPointS: clamp(finite(raw?.timePerPointS, d.timePerPointS), 0.5, 120),
    firstPointS: autoOr(raw?.firstPointS, d.firstPointS, 0.5, 300),
    advance: raw?.advance === "early" ? "early" : "timed",
    minHoldS: clamp(finite(raw?.minHoldS, d.minHoldS), 0, 10),
    workingTimeS: autoOr(raw?.workingTimeS, d.workingTimeS, 1, 600),
    repeat: typeof raw?.repeat === "boolean" ? raw.repeat : d.repeat,
    orientationDeg: ((finite(raw?.orientationDeg, 0) % 360) + 360) % 360,
    exitPieceSize: (() => {
      const v = autoOr(raw?.exitPieceSize, d.exitPieceSize, 1, 1000);
      return v === "auto" ? v : Math.round(v);
    })(),
    breakoffFt: clamp(finite(raw?.breakoffFt, d.breakoffFt), 1000, 15000),
  };
}
