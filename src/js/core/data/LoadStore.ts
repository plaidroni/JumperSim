// Replacing the whole load (jumpers + formations) from anywhere in the UI without
// importing Scripts.ts. Scripts.ts registers the function that rebuilds the scene.

import type { SimJumper, SimPlane } from "../../classes/SimEntities";
import type { FormationSequence } from "../../formations/FormationSequence";

export interface LoadState {
  jumpers: SimJumper[];
  formations: FormationSequence[];
}

type Replacer = (state: LoadState) => void;
let replacer: Replacer | null = null;

export function setLoadReplacer(fn: Replacer) {
  replacer = fn;
}

/** Swap in a new load: meshes, trajectory lines, panels and the physics all follow. */
export function replaceLoad(state: LoadState) {
  if (!replacer) throw new Error("The scene isn't ready yet.");
  replacer(state);
}

/** The load as it is now. */
export function currentLoad(): LoadState {
  const w = window as any;
  const jumpers: SimJumper[] = Array.isArray(w.simJumpers) ? [...w.simJumpers] : [];
  const plane: SimPlane | undefined = w.simPlane;
  const formations: FormationSequence[] = w.fleet?.formations ? [...w.fleet.formations] : [...(plane?.formations ?? [])];
  return { jumpers, formations };
}
