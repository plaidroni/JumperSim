// The .jsim file: the whole JumperSim environment as JSON (specs/formation-jumps.md §12).
// Pure: no DOM, no three.js. Everything read from a file is validated and coerced here,
// so nothing from a file reaches the page as markup.

import { sanitizeJumpSettings, type JumpSettings } from "./JumpSettings";
import { sanitizeSequenceSettings, type SequenceSettings } from "../../formations/FormationSequence";
import { isAircraftId, type AircraftId } from "../../fleet/Aircraft";
import { FLEET_LAYOUT_ORDER, type FleetLayoutId } from "../../fleet/Fleet";
import { BODY_POSITION_ORDER, type BodyPosition } from "../../physics/BodyPositions";
import { FLOCK_LAYOUT_ORDER } from "../../physics/FlockShapes";
import type { ParsedPoint } from "../../formations/JumpFile";

export const JSIM_FORMAT = "jumpersim";
export const JSIM_VERSION = 1;
export const JSIM_LIMITS = { planes: 10, jumpers: 1000, points: 100, bytes: 2 * 1024 * 1024 };

export interface JsimPlane {
  id: string;
  label: string;
  aircraft: AircraftId;
  floaters: number | null;
  goOffsetS: number;
}

export interface JsimJumper {
  id: string;
  plane: string;
  exitOrder: number;
  initialExit: boolean;
  wantsFloat: boolean;
  inExitPiece: boolean;
  name: string | null;
  color: string | null;
  position: BodyPosition;
  tracking: boolean;
  weightKg: number;
  extraWeightKg: number;
  suit: "normal" | "baggy" | "skintight";
  canopySqft: number;
  pullFt: number;
  linked: boolean;
  formationSlot: number | null;
  laneIndex: number | null;
  freefallPatternId: string | null;
}

export interface JsimFormation {
  id: string;
  title: string;
  source: { file: string; docVersion: number };
  settings: SequenceSettings;
  points: ParsedPoint[];
  /** Jumper id per slot (null = empty slot). */
  members: (string | null)[];
}

export interface JsimEnvironment {
  format: typeof JSIM_FORMAT;
  version: number;
  savedAt: string;
  appVersion: string;
  jump: JumpSettings;
  dropzone: { name: string; latitude: number; longitude: number; elevationFt: number | null; country: string } | null;
  /** DropzonePlan (validated again by DropzonePlan.useFilePlan). */
  plan: unknown;
  load: {
    exitIntervalS: number;
    linkedFormation: "round" | "none";
    roundSettings: { slotRadiusM: number | "auto"; breakoffFt: number; breakoffDistanceM: number | "auto" };
    flockSettings: { layout: string; spacingM: number; stackM: number; breakoffFt: number };
    minDeploySeparationM: number;
    fleet: { layout: FleetLayoutId; spacing: { backM: number; rightM: number; upM: number }; planes: JsimPlane[] };
    jumpers: JsimJumper[];
    formations: JsimFormation[];
  };
  weather: { mode: "saved" | "live"; override: string | null; state: any | null };
  view: { time: number; speed: number; camera: { position: number[]; target: number[] } | null } | null;
}

export class JsimError extends Error {}

// ---------------------------------------------------------------- coercion helpers

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) => (isNum(v) ? clamp(v, lo, hi) : d);
const int = (v: unknown, d: number, lo = -Infinity, hi = Infinity) => Math.round(num(v, d, lo, hi));
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const autoNum = (v: unknown, d: number | "auto", lo: number, hi: number): number | "auto" =>
  v === "auto" ? "auto" : isNum(v) && v > 0 ? clamp(v, lo, hi) : d;

/** Plain text: no markup characters, trimmed, at most `max` characters. */
export function safeText(v: unknown, max = 100): string {
  if (typeof v !== "string") return "";
  return v.replace(/[<>&"`\u0000-\u001f]/g, "").trim().slice(0, max);
}

const safeId = (v: unknown, d: string) => {
  const s = typeof v === "string" ? v.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 64) : "";
  return s || d;
};

const safeColor = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
  return m ? `#${m[1].toUpperCase()}` : null;
};

function oneOf<T extends string>(v: unknown, list: readonly T[], d: T): T {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : d;
}

// ---------------------------------------------------------------- weather

const WEATHER_ENUMS: Record<string, readonly string[]> = {
  kind: ["none", "drizzle", "rain", "showers", "snow", "thunderstorm"],
  band: ["fog", "low", "mid", "high"],
};

function validTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || tz.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Numbers stay numbers (null → NaN, the model's "no value"), strings become plain text. */
function sanitizeWeatherValue(v: unknown, key: string, depth: number): unknown {
  if (depth > 6) return undefined;
  if (v === null) return NaN;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (WEATHER_ENUMS[key]) return oneOf(v, WEATHER_ENUMS[key] as string[], WEATHER_ENUMS[key][0]);
    return safeText(v, 64);
  }
  if (Array.isArray(v)) return v.slice(0, 500).map((x) => sanitizeWeatherValue(x, key, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as object).slice(0, 80)) {
      if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
      out[k] = sanitizeWeatherValue(x, k, depth + 1);
    }
    return out;
  }
  return undefined;
}

function sanitizeWeatherState(raw: any): any | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.levels) || !raw.surface) return null;
  const s: any = sanitizeWeatherValue(raw, "", 0);
  s.timezone = validTimeZone(raw.timezone);
  s.dz = { name: safeText(raw.dz?.name, 100), lat: num(raw.dz?.lat, 0, -90, 90), lon: num(raw.dz?.lon, 0, -180, 180) };
  if (!isNum(s.validTime)) s.validTime = Date.now();
  if (!isNum(s.fetchedAt)) s.fetchedAt = s.validTime;
  if (!isNum(s.elevationM)) s.elevationM = 0;
  s.levels = (s.levels as any[]).filter((l) => l && isNum(l.aglM) && isNum(l.windMs) && isNum(l.windFromDeg));
  return s.levels.length ? s : null;
}

// ---------------------------------------------------------------- points

function sanitizePoints(raw: unknown, warnings: string[]): ParsedPoint[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  if (raw.length > JSIM_LIMITS.points) throw new JsimError(`Too many points (${raw.length}; max ${JSIM_LIMITS.points}).`);
  const points = raw.map((p: any, k) => ({
    label: safeText(p?.label, 40) || String(k + 1),
    inter: bool(p?.inter, false),
    slots: (Array.isArray(p?.slots) ? p.slots : []).slice(0, JSIM_LIMITS.jumpers).map((s: any) => ({
      x: num(s?.x, 0, -500, 500),
      y: num(s?.y, 0, -500, 500),
      headingDeg: ((num(s?.headingDeg, 0) % 360) + 360) % 360,
      stance: safeText(s?.stance, 40) || "belly",
    })),
  }));
  const n = points[0].slots.length;
  if (!n || points.some((p) => p.slots.length !== n)) {
    warnings.push("A formation's points have different slot counts; it was dropped.");
    return null;
  }
  return points;
}

// ---------------------------------------------------------------- parse / serialize

/** Read and validate a .jsim file. Throws JsimError for files that can't be used. */
export function parseJsim(text: string): { env: JsimEnvironment; warnings: string[] } {
  if (text.length > JSIM_LIMITS.bytes) throw new JsimError("That file is too large for a .jsim (over 2 MB).");
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new JsimError("Not a JumperSim file (not JSON).");
  }
  if (!raw || raw.format !== JSIM_FORMAT) throw new JsimError("Not a JumperSim (.jsim) file.");
  if (!isNum(raw.version) || raw.version < 1) throw new JsimError("Not a JumperSim (.jsim) file (no version).");
  if (raw.version > JSIM_VERSION) throw new JsimError("Made with a newer JumperSim. Update the app to open it.");
  raw = migrate(raw);
  const warnings: string[] = [];

  const load = raw.load ?? {};
  // planes
  const rawPlanes: any[] = Array.isArray(load.fleet?.planes) ? load.fleet.planes : [];
  if (rawPlanes.length > JSIM_LIMITS.planes) throw new JsimError(`Too many planes (${rawPlanes.length}; max ${JSIM_LIMITS.planes}).`);
  const seenPlane = new Set<string>();
  const planes: JsimPlane[] = rawPlanes.map((p, k) => {
    let id = safeId(p?.id, `p${k + 1}`);
    if (seenPlane.has(id)) id = `p${k + 1}_${k}`;
    seenPlane.add(id);
    const aircraft: AircraftId = isAircraftId(p?.aircraft) ? p.aircraft : "twin-otter";
    if (!isAircraftId(p?.aircraft)) warnings.push(`Unknown aircraft "${safeText(p?.aircraft, 30)}" flown as a Twin Otter.`);
    return {
      id,
      label: safeText(p?.label, 40) || (k === 0 ? "Lead" : `Plane ${k + 1}`),
      aircraft,
      floaters: p?.floaters === null || p?.floaters === undefined ? null : int(p.floaters, 0, 0, 10),
      goOffsetS: num(p?.goOffsetS, 0, -10, 30),
    };
  });
  if (!planes.length) planes.push({ id: "p1", label: "Lead", aircraft: "twin-otter", floaters: null, goOffsetS: 0 });
  const planeIds = new Set(planes.map((p) => p.id));

  // jumpers
  const rawJumpers: any[] = Array.isArray(load.jumpers) ? load.jumpers : [];
  if (rawJumpers.length > JSIM_LIMITS.jumpers) throw new JsimError(`Too many jumpers (${rawJumpers.length}; max ${JSIM_LIMITS.jumpers}).`);
  const seenJ = new Set<string>();
  let movedToLead = 0;
  const jumpers: JsimJumper[] = rawJumpers.map((j, k) => {
    let id = safeId(j?.id, `j${k + 1}`);
    if (seenJ.has(id)) id = `j${k + 1}_${k}`;
    seenJ.add(id);
    let plane = safeId(j?.plane, planes[0].id);
    if (!planeIds.has(plane)) {
      plane = planes[0].id;
      movedToLead++;
    }
    return {
      id,
      plane,
      exitOrder: int(j?.exitOrder, k, 0, JSIM_LIMITS.jumpers),
      initialExit: bool(j?.initialExit, false),
      wantsFloat: bool(j?.wantsFloat, false),
      inExitPiece: bool(j?.inExitPiece, false),
      name: safeText(j?.name, 100) || null,
      color: safeColor(j?.color),
      position: oneOf(j?.position, BODY_POSITION_ORDER, "belly"),
      tracking: bool(j?.tracking, true),
      weightKg: num(j?.weightKg, 80, 30, 200),
      extraWeightKg: num(j?.extraWeightKg, 0, 0, 50),
      suit: oneOf(j?.suit, ["normal", "baggy", "skintight"] as const, "normal"),
      canopySqft: num(j?.canopySqft, 190, 50, 400),
      pullFt: num(j?.pullFt, 4500, 1500, 15000),
      linked: bool(j?.linked, false),
      formationSlot: j?.formationSlot === null || j?.formationSlot === undefined ? null : int(j.formationSlot, 1, 1, JSIM_LIMITS.jumpers),
      laneIndex: j?.laneIndex === null || j?.laneIndex === undefined ? null : int(j.laneIndex, 0, -10, 10),
      freefallPatternId: j?.freefallPatternId ? safeId(j.freefallPatternId, "") || null : null,
    };
  });
  if (movedToLead) warnings.push(`${movedToLead} jumper${movedToLead > 1 ? "s were" : " was"} on a missing plane and moved to the lead.`);
  const jumperIds = new Set(jumpers.map((j) => j.id));

  // formations
  const formations: JsimFormation[] = [];
  (Array.isArray(load.formations) ? load.formations : []).slice(0, 20).forEach((f: any, k: number) => {
    const points = sanitizePoints(f?.points, warnings);
    if (!points) return;
    const n = points[0].slots.length;
    const used = new Set<string>();
    let missing = 0;
    const members = Array.from({ length: n }, (_, i) => {
      const id = Array.isArray(f?.members) ? f.members[i] : null;
      if (typeof id !== "string") return null;
      const sid = safeId(id, "");
      if (!jumperIds.has(sid) || used.has(sid)) {
        missing++;
        return null;
      }
      used.add(sid);
      return sid;
    });
    if (missing) warnings.push(`${missing} formation member${missing > 1 ? "s" : ""} weren't in the file and left the formation.`);
    formations.push({
      id: safeId(f?.id, `f${k + 1}`),
      title: safeText(f?.title, 100) || `Formation ${k + 1}`,
      source: { file: safeText(f?.source?.file, 120), docVersion: int(f?.source?.docVersion, 2, 0, 99) },
      settings: sanitizeSequenceSettings(f?.settings ?? {}),
      points,
      members,
    });
  });

  // dropzone
  const dz = raw.dropzone;
  const dropzone =
    dz && isNum(dz.latitude) && isNum(dz.longitude)
      ? {
          name: safeText(dz.name, 100) || "Dropzone",
          latitude: clamp(dz.latitude, -90, 90),
          longitude: clamp(dz.longitude, -180, 180),
          elevationFt: isNum(dz.elevationFt) ? dz.elevationFt : null,
          country: safeText(dz.country, 60),
        }
      : null;

  const rs = load.roundSettings ?? {};
  const fs = load.flockSettings ?? {};
  const weatherState = raw.weather?.mode === "saved" ? sanitizeWeatherState(raw.weather?.state) : null;
  if (raw.weather?.mode === "saved" && !weatherState) warnings.push("The saved weather couldn't be read; using live weather.");
  const cam = raw.view?.camera;
  const vec3 = (v: unknown) => (Array.isArray(v) && v.length === 3 && v.every(isNum) ? (v as number[]).map((x) => clamp(x, -1e7, 1e7)) : null);

  const env: JsimEnvironment = {
    format: JSIM_FORMAT,
    version: JSIM_VERSION,
    savedAt: typeof raw.savedAt === "string" ? safeText(raw.savedAt, 40) : "",
    appVersion: typeof raw.appVersion === "string" ? safeText(raw.appVersion, 20) : "",
    jump: (() => {
      const j = sanitizeJumpSettings(raw.jump ?? {});
      return { ...j, name: safeText(j.name, 100) || "Untitled JumpSim" };
    })(),
    dropzone,
    plan: raw.plan ? plainStrings(raw.plan, 0) : null,
    load: {
      exitIntervalS: num(load.exitIntervalS, 10, 0, 120),
      linkedFormation: load.linkedFormation === "none" ? "none" : "round",
      roundSettings: {
        slotRadiusM: autoNum(rs.slotRadiusM, "auto", 0.5, 50),
        breakoffFt: num(rs.breakoffFt, 4500, 1000, 15000),
        breakoffDistanceM: autoNum(rs.breakoffDistanceM, "auto", 10, 2000),
      },
      flockSettings: {
        layout: oneOf(fs.layout, FLOCK_LAYOUT_ORDER, "arrowhead"),
        spacingM: num(fs.spacingM, 15, 2, 200),
        stackM: num(fs.stackM, 0, 0, 100),
        breakoffFt: num(fs.breakoffFt, 5500, 1000, 15000),
      },
      minDeploySeparationM: num(load.minDeploySeparationM, 150, 0, 2000),
      fleet: {
        layout: oneOf(load.fleet?.layout, FLEET_LAYOUT_ORDER, "v"),
        spacing: {
          backM: num(load.fleet?.spacing?.backM, 30, 0, 500),
          rightM: num(load.fleet?.spacing?.rightM, 40, 0, 500),
          upM: num(load.fleet?.spacing?.upM, 30, 0, 500),
        },
        planes,
      },
      jumpers,
      formations,
    },
    weather: { mode: weatherState ? "saved" : "live", override: raw.weather?.override ? safeText(raw.weather.override, 40) || null : null, state: weatherState },
    view: raw.view
      ? {
          time: num(raw.view.time, 0, 0, 3600),
          speed: num(raw.view.speed, 1, 0.1, 16),
          camera: cam && vec3(cam.position) && vec3(cam.target) ? { position: vec3(cam.position)!, target: vec3(cam.target)! } : null,
        }
      : null,
  };
  return { env, warnings };
}

/** Every string in a structure made plain text (zone and pattern names in the plan). */
function plainStrings(v: unknown, depth: number): unknown {
  if (depth > 8) return null;
  if (typeof v === "string") return safeText(v, 200);
  if (Array.isArray(v)) return v.slice(0, 2000).map((x) => plainStrings(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as object)) if (/^[A-Za-z0-9_]{1,40}$/.test(k)) out[k] = plainStrings(x, depth + 1);
    return out;
  }
  return typeof v === "number" || typeof v === "boolean" ? v : null;
}

/** Older file versions → the current shape (none yet). */
function migrate(raw: any): any {
  return raw;
}

export function serializeJsim(env: JsimEnvironment): string {
  // NaN (the weather's "no value") becomes null in JSON and back to NaN on load
  return JSON.stringify(env, null, 2);
}

/** A file name from a jump name: letters, numbers, spaces, dashes. */
export function jsimFileName(name: string): string {
  const base = name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, " ").slice(0, 80) || "JumperSim";
  return `${base}.jsim`;
}
