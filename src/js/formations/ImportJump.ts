// Upload a .jump file: parse, build jumpers + formation, replace the load
// (specs/formation-jumps.md §4, §6).

import { SimJumper, SimPlane } from "../classes/SimEntities";
import { notificationManager } from "../classes/NotificationManager";
import { replaceLoad } from "../core/data/LoadStore";
import { FormationSequence } from "./FormationSequence";
import { JumpFileError, ParsedJump, PlaneOrder, parseJumpFile } from "./JumpFile";

const ORDER_KEY = "jumpersim.import.planeOrder";

export function getPlaneOrder(): PlaneOrder {
  try {
    return localStorage.getItem(ORDER_KEY) === "fromPilot" ? "fromPilot" : "firstOut";
  } catch {
    return "firstOut";
  }
}

export function setPlaneOrder(o: PlaneOrder) {
  try {
    localStorage.setItem(ORDER_KEY, o);
  } catch {
    /* storage blocked */
  }
}

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

/** File plane order when every jumper is assigned; else slot order. */
function fileExitOrder(parsed: ParsedJump): number[] {
  const all = parsed.jumpers.every((j) => j.plane);
  if (!all || !parsed.planes.length) return parsed.jumpers.map((j) => j.slot);
  const planeRank = new Map(parsed.planes.map((p, i) => [p.id, i]));
  return [...parsed.jumpers]
    .sort((a, b) => planeRank.get(a.plane!.planeId)! - planeRank.get(b.plane!.planeId)! || a.plane!.exitOrder - b.plane!.exitOrder)
    .map((j) => j.slot);
}

export interface ImportResult {
  parsed: ParsedJump;
  sequence: FormationSequence;
  jumpers: SimJumper[];
}

/** Hooks later phases replace (plane split, undo); the default flies one plane. */
export const importHooks = {
  place: (parsed: ParsedJump, plane: SimPlane): ImportResult => {
    const jumpers = jumpersFromParsed(parsed, plane);
    const sequence = FormationSequence.fromParsed(parsed, jumpers);
    const order = fileExitOrder(parsed);
    const ordered = order.map((slot) => jumpers[slot]);
    ordered.forEach((j, k) => (j.index = k));
    return { parsed, sequence, jumpers: ordered };
  },
  apply: (r: ImportResult) => {
    replaceLoad({ jumpers: r.jumpers, formations: [r.sequence] });
    return `${r.jumpers.length} jumpers, ${r.sequence.points.length} point${r.sequence.points.length > 1 ? "s" : ""}`;
  },
};

/** Import a .jump file's text. Returns the result, or null after showing an error. */
export function importJumpText(text: string, fileName: string): ImportResult | null {
  const plane: SimPlane | undefined = (window as any).simPlane;
  if (!plane) return null;
  let parsed: ParsedJump;
  try {
    parsed = parseJumpFile(text, fileName, { planeOrder: getPlaneOrder() });
  } catch (e) {
    notificationManager.error(e instanceof JumpFileError ? e.message : "Couldn't read that .jump file.");
    if (!(e instanceof JumpFileError)) console.error(e);
    return null;
  }
  const result = importHooks.place(parsed, plane);
  const summary = importHooks.apply(result);
  const warn = parsed.warnings.length ? ` · ⚠ ${parsed.warnings.join(" ")}` : "";
  notificationManager.success(`Imported ${parsed.title}: ${summary}${warn}`, { duration: parsed.warnings.length ? 9000 : 5000 });
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
