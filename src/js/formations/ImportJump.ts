// Upload a .jump file: parse, work out the planes, split the jumpers, replace (or add
// to) the load, with Undo (specs/formation-jumps.md §4, §6).

import { SimJumper, SimPlane } from "../classes/SimEntities";
import { notificationManager } from "../classes/NotificationManager";
import { replaceLoad } from "../core/data/LoadStore";
import { AIRCRAFT } from "../fleet/Aircraft";
import { Fleet, FleetSnapshot, getFleet } from "../fleet/Fleet";
import { FormationSequence, sequenceOf } from "./FormationSequence";
import { JumpFileError, ParsedJump, PlaneOrder, parseJumpFile } from "./JumpFile";
import { SlotPlacement, SplitError, placeSlots, resplitOnto, splitLoad } from "./LoadSplit";

const ORDER_KEY = "jumpersim.import.planeOrder";
const MODE_KEY = "jumpersim.import.mode";

export type ImportMode = "replace" | "add";

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage blocked */
  }
}

export const getPlaneOrder = (): PlaneOrder => (readPref(ORDER_KEY) === "fromPilot" ? "fromPilot" : "firstOut");
export const setPlaneOrder = (o: PlaneOrder) => writePref(ORDER_KEY, o);
export const getImportMode = (): ImportMode => (readPref(MODE_KEY) === "add" ? "add" : "replace");
export const setImportMode = (m: ImportMode) => writePref(MODE_KEY, m);

/** One SimJumper per slot, with the file's name and colour. */
export function jumpersFromParsed(parsed: ParsedJump, plane: SimPlane): SimJumper[] {
  return parsed.jumpers.map((pj, i) => {
    const j = new SimJumper(i, plane, 0, 7, 190);
    j.weight = 80;
    j.extraWeight = 0;
    j.setBodyPosition("belly");
    if (pj.name) (j as any).name = pj.name;
    j.color = pj.color;
    j.linked = true;
    j.isInFormation = true;
    return j;
  });
}

function board(j: SimJumper, p: SimPlane) {
  j.plane = p;
  j.direction = p.direction;
  j.initialVelocity = p.vector;
}

function applyPlacement(j: SimJumper, p: SimPlane, pl: SlotPlacement) {
  board(j, p);
  j.exitOrder = pl.exitOrder;
  j.initialExit = pl.initialExit;
  j.wantsFloat = pl.floater;
  j.inExitPiece = pl.exitPiece;
}

/** Global load order: plane order, then (optionally) a plane's new formation first, then exit order. */
function reindex(fleet: Fleet, jumpers: SimJumper[], firstOnPlane: Set<SimJumper> = new Set()) {
  let k = 0;
  for (const p of fleet.planes) {
    const mine = jumpers.filter((j) => j.plane === p);
    const lead = mine.filter((j) => firstOnPlane.has(j)).sort((a, b) => a.exitOrder - b.exitOrder);
    const rest = mine.filter((j) => !firstOnPlane.has(j)).sort((a, b) => a.index - b.index || a.exitOrder - b.exitOrder);
    [...lead, ...rest].forEach((j) => (j.index = k++));
  }
}

// ---------------------------------------------------------------- undo

interface Environment {
  fleet: FleetSnapshot;
  jumpers: SimJumper[];
  state: { j: SimJumper; plane: SimPlane; exitOrder: number; index: number; initialExit: boolean; wantsFloat: boolean; inExitPiece: boolean }[];
}

export function captureEnvironment(fleet: Fleet): Environment {
  const jumpers: SimJumper[] = [...((window as any).simJumpers ?? [])];
  return {
    fleet: fleet.snapshot(),
    jumpers,
    state: jumpers.map((j) => ({
      j,
      plane: j.plane as SimPlane,
      exitOrder: j.exitOrder,
      index: j.index,
      initialExit: j.initialExit,
      wantsFloat: j.wantsFloat,
      inExitPiece: j.inExitPiece,
    })),
  };
}

export function restoreEnvironment(fleet: Fleet, env: Environment) {
  fleet.restore(env.fleet);
  env.state.forEach((s) => {
    board(s.j, s.plane);
    Object.assign(s.j, { exitOrder: s.exitOrder, index: s.index, initialExit: s.initialExit, wantsFloat: s.wantsFloat, inExitPiece: s.inExitPiece });
  });
  replaceLoad({ jumpers: env.jumpers, formations: env.fleet.formations });
}

// ---------------------------------------------------------------- placing

export interface ImportResult {
  parsed: ParsedJump;
  sequence: FormationSequence;
  jumpers: SimJumper[];
  summary: string;
  notes: string[];
}

function planeSummary(planes: SimPlane[], counts: number[], source: string) {
  const kinds = new Set(planes.map((p) => p.aircraftId));
  const what =
    kinds.size === 1
      ? `${planes.length} × ${AIRCRAFT[planes[0].aircraftId].name}`
      : planes.map((p) => AIRCRAFT[p.aircraftId].name).join(" + ");
  return planes.length === 1 ? `1 ${AIRCRAFT[planes[0].aircraftId].name}` : `${what} (${counts.join(" + ")}${source})`;
}

/** Replace the load: the file's planes, or as many of the preferred aircraft as needed. */
function replaceWithSplit(parsed: ParsedJump, fleet: Fleet, preferredPlane: SimPlane): ImportResult {
  const split = splitLoad(parsed, { preferred: preferredPlane.aircraftId, layout: fleet.layout });
  const lead = fleet.lead;
  const planes = split.planes.map((pp, k) => {
    const p = k === 0 ? lead : fleet.createPlane(pp.aircraft, pp.label);
    p.label = pp.label;
    p.floaters = pp.floaters;
    return p;
  });
  const leadAircraft = split.planes[0].aircraft;
  fleet.setPlanes(planes);
  if (lead.aircraftId !== leadAircraft) fleet.setAircraft(lead, leadAircraft);
  const jumpers = jumpersFromParsed(parsed, lead);
  split.placements.forEach((pl) => applyPlacement(jumpers[pl.slot], planes[pl.plane], pl));
  const sequence = FormationSequence.fromParsed(parsed, jumpers);
  reindex(fleet, jumpers, new Set(jumpers)); // all new: their planned exit order wins
  const ordered = [...jumpers].sort((a, b) => a.index - b.index);
  replaceLoad({ jumpers: ordered, formations: [sequence] });
  const tag = split.source === "file" || split.source === "file-counts" ? ", from the file" : "";
  return {
    parsed,
    sequence,
    jumpers: ordered,
    summary: planeSummary(planes, split.planes.map((p) => p.count), tag),
    notes: split.notes,
  };
}

/** Add to the load: the selected plane if it has room, else new planes after the others. */
function addToLoad(parsed: ParsedJump, fleet: Fleet, sel: SimPlane): ImportResult {
  const existing: SimJumper[] = [...((window as any).simJumpers ?? [])];
  const n = parsed.jumpers.length;
  const used = existing.filter((j) => j.plane === sel).length;
  const free = (sel.capacity ?? Infinity) - used;
  const jumpers = jumpersFromParsed(parsed, sel);
  let planes: SimPlane[];
  let counts: number[];
  let notes: string[] = [];
  if (n <= free) {
    const placements = placeSlots(parsed, [{ aircraft: sel.aircraftId, label: sel.label, floaters: sel.floaters, count: n }], {});
    placements.forEach((pl) => applyPlacement(jumpers[pl.slot], sel, pl));
    planes = [sel];
    counts = [n];
  } else {
    const split = splitLoad(parsed, { preferred: sel.aircraftId, layout: fleet.layout });
    if (fleet.planes.length + split.planes.length > 10) throw new SplitError("That needs more than 10 planes in all.");
    planes = split.planes.map((pp) => {
      const p = fleet.createPlane(pp.aircraft, pp.label === "Lead" ? `Plane ${fleet.planes.length + 1}` : pp.label);
      p.floaters = pp.floaters;
      return p;
    });
    fleet.setPlanes([...fleet.planes, ...planes]);
    planes.forEach((p, k) => (p.label = split.planes[k].label === "Lead" || /^Plane \d+$/.test(split.planes[k].label) ? `Plane ${fleet.planes.indexOf(p) + 1}` : p.label));
    split.placements.forEach((pl) => applyPlacement(jumpers[pl.slot], planes[pl.plane], { ...pl, exitPiece: false }));
    counts = split.planes.map((p) => p.count);
    notes = split.notes;
  }
  const sequence = FormationSequence.fromParsed(parsed, jumpers);
  const all = [...existing, ...jumpers];
  reindex(fleet, all, new Set(jumpers));
  const ordered = all.sort((a, b) => a.index - b.index);
  replaceLoad({ jumpers: ordered, formations: [...fleet.formations, sequence] });
  return { parsed, sequence, jumpers, summary: `added to ${planeSummary(planes, counts, "")}`, notes };
}

/** Re-split a formation across the fleet's current planes (formation ⚙ → Re-split). */
export function resplitFormation(seq: FormationSequence) {
  const fleet = getFleet();
  if (!fleet) return;
  const env = captureEnvironment(fleet);
  const members = seq.members;
  const n = members.length;
  const placements = resplitOnto(
    { points: seq.points, jumpers: members.map((_, i) => ({ slot: i, name: null, color: "", fileColor: "", plane: null })), planes: [] },
    fleet.planes.map((p) => ({ aircraft: p.aircraftId, label: p.label, floaters: p.floaters })),
    { exitPieceSize: seq.settings.exitPieceSize, offsets: fleet.planes.map((p) => p.offset) },
  );
  placements.forEach((pl) => {
    const j = members[pl.slot];
    if (j) applyPlacement(j, fleet.planes[pl.plane], pl);
  });
  const all: SimJumper[] = [...((window as any).simJumpers ?? [])];
  reindex(fleet, all, new Set(members.filter((m): m is SimJumper => !!m)));
  replaceLoad({ jumpers: all.sort((a, b) => a.index - b.index), formations: fleet.formations });
  notificationManager.success(`Re-split ${n} jumpers across ${fleet.planes.length} plane${fleet.planes.length > 1 ? "s" : ""}.`, {
    actions: [{ label: "Undo", callback: () => restoreEnvironment(fleet, env) }],
  });
}

// ---------------------------------------------------------------- entry points

/** Import a .jump file's text. Returns the result, or null after showing an error. */
export function importJumpText(text: string, fileName: string): ImportResult | null {
  const fleet = getFleet();
  const plane: SimPlane | undefined = (window as any).simPlane;
  if (!plane || !fleet) return null;
  let parsed: ParsedJump;
  try {
    parsed = parseJumpFile(text, fileName, { planeOrder: getPlaneOrder() });
  } catch (e) {
    notificationManager.error(e instanceof JumpFileError ? e.message : "Couldn't read that .jump file.");
    if (!(e instanceof JumpFileError)) console.error(e);
    return null;
  }
  const preferred: SimPlane = (window as any).planeLoadSelectedPlane?.() ?? fleet.lead;
  const env = captureEnvironment(fleet);
  let result: ImportResult;
  try {
    result = getImportMode() === "add" ? addToLoad(parsed, fleet, preferred) : replaceWithSplit(parsed, fleet, preferred);
  } catch (e) {
    restoreEnvironment(fleet, env);
    notificationManager.error(e instanceof SplitError ? e.message : "Couldn't place that formation.");
    if (!(e instanceof SplitError)) console.error(e);
    return null;
  }
  const n = parsed.jumpers.length;
  const pts = parsed.points.length;
  const warnings = [...result.notes, ...parsed.warnings];
  notificationManager.success(
    `Imported ${parsed.title}: ${n} jumper${n > 1 ? "s" : ""}, ${pts} point${pts > 1 ? "s" : ""} → ${result.summary}` +
      (warnings.length ? ` · ⚠ ${warnings.join(". ")}.` : ""),
    {
      duration: warnings.length ? 12000 : 8000,
      actions: [
        { label: "Undo", callback: () => restoreEnvironment(fleet, env) },
        {
          label: "Show",
          callback: () => {
            (window as any).dock?.focus?.("plane");
            const pl = (window as any).simPlane?.planeLoad;
            pl?.selectPlane?.(fleet.lead.id);
          },
        },
      ],
    },
  );
  return result;
}

/** Ask for a .jump file and import it. */
export function pickAndImportJump() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".jump,application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file) importJumpText(await file.text(), file.name);
  };
  input.click();
}

export { sequenceOf };
