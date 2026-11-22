// Exit order and jump times for every plane (specs/formation-jumps.md §5.4).
//
// On each plane, in exit order:
//   1. formations first: the initial exit (floaters + in-door jumpers) leaves on "go",
//      the rest one door interval apart. Every plane goes on the lead's call.
//   2. then the other groups, `exitIntervalS` apart: a plane's linked (non-.jump) jumpers
//      leave together (wingsuiters 1 s apart, base first), everyone else on their own.

import type { SimJumper, SimPlane } from "../classes/SimEntities";
import { sequenceOf, type FormationSequence } from "../formations/FormationSequence";
import { orderBySlot, isWingsuiter } from "../physics/FormationFlight";
import { FLOCK_EXIT_GAP_S } from "../physics/FlockShapes";
import { aircraft, floatersFor, initialExitCount } from "./Aircraft";

export interface ScheduleInput {
  planes: SimPlane[];
  jumpers: SimJumper[];
  formations: FormationSequence[];
  exitIntervalS: number;
}

export interface ScheduleResult {
  /** "go" time per formation id. */
  goTimes: Map<string, number>;
}

/** Set jumpTime, isFloater and exitSpot for every jumper. */
export function scheduleExits({ planes, jumpers, formations, exitIntervalS }: ScheduleInput): ScheduleResult {
  const interval = Math.max(0, exitIntervalS);
  const byPlane = new Map<SimPlane, SimJumper[]>();
  planes.forEach((p) => byPlane.set(p, []));
  for (const j of jumpers) {
    const p = (byPlane.has(j.plane as SimPlane) ? j.plane : planes[0]) as SimPlane;
    byPlane.get(p)!.push(j);
  }
  byPlane.forEach((list) => {
    list.sort((a, b) => a.exitOrder - b.exitOrder || a.index - b.index);
    list.forEach((j, k) => {
      j.exitOrder = k;
      j.isFloater = false;
      j.exitSpot = null;
    });
  });

  // formations in the order they first appear in the load
  const order = [...formations].sort((a, b) => firstIndex(a, jumpers) - firstIndex(b, jumpers));
  const goTimes = new Map<string, number>();
  let go = 0;
  const lastExit = new Map<SimPlane, number>(); // per plane: when its formation exits end

  for (const f of order) {
    goTimes.set(f.id, go);
    let latest = go;
    for (const p of planes) {
      const members = byPlane.get(p)!.filter((j) => sequenceOf(j) === f);
      if (!members.length) continue;
      const spec = aircraft(p.aircraftId);
      const pGo = go + (p.goOffsetS || 0);
      const initial = initialExitCount(spec, members.length, p.floaters);
      const floaters = floatersFor(spec, initial, p.floaters);
      // floaters are flagged by the split (outside of the piece); else the first out
      let flagged = members.slice(0, initial).filter((j) => (j as any).wantsFloat);
      if (flagged.length !== floaters) flagged = members.slice(0, floaters);
      let spot = 0;
      members.forEach((j, n) => {
        if (n < initial) {
          j.jumpTime = pGo;
          if (flagged.includes(j) && spot < p.floaterSpots.length) {
            j.isFloater = true;
            j.exitSpot = p.floaterSpots[spot++];
          }
        } else {
          j.jumpTime = pGo + (n - initial + 1) * spec.doorIntervalS;
        }
        latest = Math.max(latest, j.jumpTime);
        lastExit.set(p, Math.max(lastExit.get(p) ?? -Infinity, j.jumpTime));
      });
    }
    go = latest + interval;
  }

  // everyone else, per plane, after that plane's formation exits
  for (const p of planes) {
    const rest = byPlane.get(p)!.filter((j) => !sequenceOf(j));
    if (!rest.length) continue;
    let t = lastExit.has(p) ? lastExit.get(p)! + interval : 0;
    const linked = rest.filter((j) => j.linked);
    const firstLinked = linked.length ? rest.indexOf(linked[0]) : -1;
    const groups: SimJumper[][] = [];
    rest.forEach((j, i) => {
      if (j.linked) {
        if (i === firstLinked) groups.push(linked);
      } else groups.push([j]);
    });
    for (const g of groups) {
      const suits = orderBySlot(g.filter((j) => g.length > 1 && isWingsuiter(j)));
      g.forEach((j) => {
        const k = suits.indexOf(j);
        j.jumpTime = k >= 0 ? t + k * FLOCK_EXIT_GAP_S : t;
      });
      t += interval;
    }
  }
  return { goTimes };
}

function firstIndex(f: FormationSequence, jumpers: SimJumper[]) {
  const idx = f.getAllJumpers().map((j) => jumpers.indexOf(j)).filter((i) => i >= 0);
  return idx.length ? Math.min(...idx.map((i) => jumpers[i].index)) : Infinity;
}
