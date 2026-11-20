import { CLOUD_TYPE_LABEL, coverLabel } from "./CloudLayers";
import { M_PER_STATUTE_MILE, M_TO_FT, WeatherState } from "./WeatherState";

/**
 * Jump conditions against 14 CFR 105.17 (specs/weather-clouds-visibility.md §6.8).
 * Informational, not a go/no-go: cloud positions are illustrative and the
 * visibility is the model's surface visibility.
 *
 * 105.17: no parachute operation into or through a cloud, and
 *   ≤ 1,200 ft AGL, or > 1,200 ft AGL and < 10,000 ft MSL: 3 sm; 500 ft below,
 *     1,000 ft above, 2,000 ft horizontal from cloud
 *   > 1,200 ft AGL and ≥ 10,000 ft MSL: 5 sm; 1,000 ft below, 1,000 ft above,
 *     1 sm horizontal
 */

export type ConditionStatus = "ok" | "warn" | "fail" | "info";
export interface ConditionItem {
  status: ConditionStatus;
  text: string;
}

export interface Minimums {
  visSm: number;
  belowFt: number;
  aboveFt: number;
  horizontal: string;
}

/** 105.17 minimums at a height (m AGL) over ground at `elevationM` (m MSL). */
export function minimumsAt(aglM: number, elevationM: number): Minimums {
  const aglFt = aglM * M_TO_FT;
  const mslFt = (aglM + elevationM) * M_TO_FT;
  if (aglFt > 1200 && mslFt >= 10000) {
    return { visSm: 5, belowFt: 1000, aboveFt: 1000, horizontal: "1 sm" };
  }
  return { visSm: 3, belowFt: 500, aboveFt: 1000, horizontal: "2,000 ft" };
}

const num = (m: number) => (Math.round((m * M_TO_FT) / 100) * 100).toLocaleString();
const ft = (m: number) => `${num(m)} ft`;
/** "4,200–6,100 ft" */
const ftRange = (a: number, b: number) => `${num(a)}–${num(b)} ft`;

export function jumpConditions(
  state: WeatherState,
  exitAglM: number,
  applyFaa: boolean,
): { rule: "faa" | "none"; items: ConditionItem[] } {
  const elev = Number.isFinite(state.elevationM) ? state.elevationM : 0;
  const visSm = state.visibilityM / M_PER_STATUTE_MILE;
  const visText = Number.isFinite(visSm) ? `${visSm < 10 ? visSm.toFixed(1) : Math.round(visSm)} sm` : "unknown";
  const exitMsl = `${ft(exitAglM + elev)} MSL`;
  const items: ConditionItem[] = [];

  if (!applyFaa) {
    items.push({ status: "info", text: `Visibility ${visText}` });
    for (const l of state.clouds.layers) {
      items.push({
        status: "info",
        text: `${coverLabel(l.coverPct)} ${CLOUD_TYPE_LABEL[l.type].abbr} ${ftRange(l.baseAglM, l.topAglM)} AGL`,
      });
    }
    items.push({ status: "info", text: "No pass/fail here: only the US (FAA) minimums are built in." });
    return { rule: "none", items };
  }

  const atExit = minimumsAt(exitAglM, elev);
  if (!Number.isFinite(visSm)) {
    items.push({ status: "warn", text: "Visibility unknown" });
  } else if (visSm >= atExit.visSm) {
    items.push({ status: "ok", text: `Visibility ${visText}: ${atExit.visSm} sm needed at the exit (${exitMsl})` });
  } else {
    const lower = atExit.visSm === 5 && visSm >= 3 ? " (3 sm is enough for an exit below 10,000 ft MSL)" : "";
    items.push({
      status: "fail",
      text: `Visibility ${visText}: ${atExit.visSm} sm needed at the exit (${exitMsl})${lower}`,
    });
  }

  let cloudIssue = false;
  for (const l of state.clouds.layers) {
    const name = `${coverLabel(l.coverPct)} ${CLOUD_TYPE_LABEL[l.type].abbr} ${ftRange(l.baseAglM, l.topAglM)}`;
    const atLayer = minimumsAt(l.baseAglM, elev);
    const belowM = atExit.belowFt / M_TO_FT;
    const aboveM = atExit.aboveFt / M_TO_FT;

    if (exitAglM >= l.baseAglM && exitAglM <= l.topAglM) {
      cloudIssue = true;
      items.push({ status: "fail", text: `The exit (${ft(exitAglM)} AGL) is inside the ${name} layer` });
      continue;
    }
    if (exitAglM < l.baseAglM && l.baseAglM - exitAglM < belowM) {
      cloudIssue = true;
      items.push({
        status: "fail",
        text: `The exit is ${ft(l.baseAglM - exitAglM)} below the ${name} layer; ${atExit.belowFt.toLocaleString()} ft needed`,
      });
      continue;
    }
    if (l.topAglM < exitAglM && exitAglM - l.topAglM < aboveM) {
      cloudIssue = true;
      items.push({
        status: "fail",
        text: `The exit is ${ft(exitAglM - l.topAglM)} above the ${name} layer; ${atExit.aboveFt.toLocaleString()} ft needed`,
      });
      continue;
    }
    if (l.topAglM < exitAglM) {
      // jumpers descend past this layer
      cloudIssue = true;
      const label = coverLabel(l.coverPct);
      if (label === "OVC") {
        items.push({ status: "fail", text: `${name} below the exit: no way through (no jumping into or through cloud)` });
      } else {
        items.push({
          status: "warn",
          text: `${name} below the exit: needs a hole that keeps ${atLayer.horizontal} from cloud`,
        });
      }
    }
  }
  if (!cloudIssue) {
    items.push({ status: "ok", text: "No cloud between the exit and the ground" });
  }
  return { rule: "faa", items };
}
