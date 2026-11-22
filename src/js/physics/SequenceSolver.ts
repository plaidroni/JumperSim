// Flies one .jump formation from exit to breakoff (specs/formation-jumps.md §8–9).
//
// Every member is stepped together (lockstep), because docking depends on who's
// already in (grips), and in "early" mode the point windows depend on everyone's dock
// times. Free divers use the drag model vertically (their weight and body position set
// the fall-rate limits) and fly a relative velocity horizontally; docked members ride
// the formation kinematically. Deterministic: same inputs, same tracks.

import * as THREE from "three";
import type { SimJumper, SimPlane } from "../classes/SimEntities";
import { FormationSequence, MissReason, SequenceResult, SequenceWindow } from "../formations/FormationSequence";
import { WindLevel, windAtHeight } from "../wind/WindProfile";
import { breakoffAltitudeFt } from "./BodyPositions";
import { DEFAULT_PULL_FT } from "./Canopy";
import { buildsRounds, formationPath, formationPlanFor, samplePath, smoothstep } from "./FormationFlight";
import {
  MS_TO_MPH,
  SEEK,
  SeekState,
  areaFor,
  bellyRange,
  fallRateMismatch,
  terminalMs,
  verticalAccel,
} from "./SlotSeeking";

const FT = 0.3048;
const K_DRAG = 0.5 * 1.0 * 1.225; // ½·Cd·ρ, same as the rest of the physics

export interface MemberTrack {
  t0: number;
  dt: number;
  /** x,y,z per step from t0. */
  pos: Float64Array;
  vel: Float64Array;
  /** Heading per step, degrees clockwise from north. */
  heading: Float32Array;
  /** Formation flying ends (breakoff for this member). */
  endTime: number;
  /** Horizontal direction to track at breakoff (out from the centre). */
  breakoffDir: THREE.Vector3;
  states: { t: number; state: SeekState; point: number }[];
  /** Adjustment arrow series every 0.1 s (§9.8). */
  adjust: { t: Float32Array; mph: Float32Array; sideX: Float32Array; sideZ: Float32Array; atLimit: Uint8Array };
  dockTimes: { window: number; t: number }[];
  missed: MissReason | null;
  fallWarning: string | null;
}

export interface SequenceSolution {
  result: SequenceResult;
  tracks: Map<SimJumper, MemberTrack>;
  centreEnd: number;
}

interface Member {
  j: SimJumper;
  slot: number;
  mass: number;
  range: { min: number; max: number; neutral: number };
  piece: boolean;
  exitTime: number;
  started: boolean;
  state: SeekState;
  point: number; // point docked in (−1 = none)
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  area: number;
  heading: number;
  // exit piece easing / transitions (offsets from the centre)
  easeFrom: THREE.Vector3 | null;
  easeT0: number;
  easeDur: number;
  easeTo: THREE.Vector3 | null;
  easeToPoint: number;
  offset: THREE.Vector3;
  offsetRate: THREE.Vector3;
  passedOuter: boolean;
  /** Low under the formation: stay out until level again (hysteresis). */
  lowGuard: boolean;
  setupSince: number;
  holdLow: boolean;
  ended: boolean;
  endTime: number;
  lastFeasible: number;
  atLimit: boolean;
  track: MemberTrack;
  n: number;
  adjN: number;
  lateWindows: Set<number>;
}

const tmp = new THREE.Vector3();

function headingOf(x: number, z: number) {
  return ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
}

function turnToward(cur: number, target: number, maxDeg: number) {
  const d = ((target - cur + 540) % 360) - 180;
  return (cur + Math.max(-maxDeg, Math.min(maxDeg, d)) + 360) % 360;
}

/** Exit position (door or floater spot) and velocity, as SimJumper.precalculate does. */
function exitState(j: SimJumper): { pos: THREE.Vector3; vel: THREE.Vector3 } {
  const p = j.plane as SimPlane;
  const s = p.track.getInterpolatedSample(j.jumpTime);
  const fwd = new THREE.Vector3(p.direction.x, 0, p.direction.z);
  if (fwd.lengthSq() < 1e-9) fwd.set(0, 0, -1);
  fwd.normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const door = j.exitSpot ?? p.doorOffset ?? { right: 0, up: 0, back: 0 };
  const base = s ? s.position.clone() : p.initialPosition.clone();
  return {
    pos: base.addScaledVector(right, door.right).addScaledVector(fwd, -door.back).add(new THREE.Vector3(0, door.up, 0)),
    vel: s ? s.velocity.clone() : p.vector.clone(),
  };
}

export function solveSequence(
  seq: FormationSequence,
  lead: SimPlane,
  wind: WindLevel[],
  duration: number,
  step = 0.01,
): SequenceSolution | null {
  const jumpers = seq.getAllJumpers().filter(buildsRounds);
  if (jumpers.length < 2) return null;
  const fp = formationPlanFor(jumpers[0], lead);
  if (!fp) return null;
  const plan = fp.plan;
  const highestPullFt = Math.max(...plan.members.map((m) => m.pullAltitudeFt ?? DEFAULT_PULL_FT));
  const breakoffY = breakoffAltitudeFt(seq.settings.breakoffFt, highestPullFt) * FT;
  const path = formationPath(plan, lead, wind, step, duration, breakoffY);
  const tGo = plan.startTime;
  const tBreak = Math.min(path.endTime, duration);
  const frame = seq.frame(lead.direction);
  const S = seq.settings;

  // slot offsets, radii and grip partners per point
  const P = seq.points.length;
  const offs = seq.points.map((_, k) => seq.members.map((_, i) => seq.slotOffset(k, i, frame)));
  const radius = seq.points.map((_, k) => seq.radius(k));
  const partners = seq.points.map((pt) =>
    pt.slots.map((s, i) => {
      const di = Math.hypot(s.x, s.y);
      return pt.slots
        .map((o, j) => ({ j, d: Math.hypot(o.x - s.x, o.y - s.y), r: Math.hypot(o.x, o.y) }))
        .filter((o) => o.j !== i && o.d <= SEEK.GRIP_DIST_M && o.r < di - 1e-6)
        .map((o) => o.j);
    }),
  );

  // exit piece: flagged by the split; else the lead's first exit
  const flagged = jumpers.some((j) => j.inExitPiece);
  const members: Member[] = jumpers.map((j) => {
    const mass = (j.weight || 80) + (j.extraWeight || 0);
    const steps = Math.max(1, Math.ceil((tBreak - j.jumpTime) / step) + 2);
    const nAdj = Math.max(1, Math.ceil((tBreak - j.jumpTime) / 0.1) + 2);
    return {
      j,
      slot: seq.slotOf(j),
      mass,
      range: bellyRange((j as any).suitType),
      piece: flagged ? j.inExitPiece : j.plane === lead && Math.abs(j.jumpTime - tGo) < 1e-6,
      exitTime: j.jumpTime,
      started: false,
      state: "exit",
      point: -1,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      area: bellyRange((j as any).suitType).neutral,
      heading: 0,
      easeFrom: null,
      easeT0: 0,
      easeDur: 0,
      easeTo: null,
      easeToPoint: -1,
      offset: new THREE.Vector3(),
      offsetRate: new THREE.Vector3(),
      passedOuter: false,
      lowGuard: false,
      setupSince: -1,
      holdLow: false,
      ended: false,
      endTime: tBreak,
      lastFeasible: -Infinity,
      atLimit: false,
      n: 0,
      adjN: 0,
      lateWindows: new Set(),
      track: {
        t0: j.jumpTime,
        dt: step,
        pos: new Float64Array(steps * 3),
        vel: new Float64Array(steps * 3),
        heading: new Float32Array(steps),
        endTime: tBreak,
        breakoffDir: new THREE.Vector3(1, 0, 0),
        states: [],
        adjust: { t: new Float32Array(nAdj), mph: new Float32Array(nAdj), sideX: new Float32Array(nAdj), sideZ: new Float32Array(nAdj), atLimit: new Uint8Array(nAdj) },
        dockTimes: [],
        missed: null,
        fallWarning: null,
      },
    };
  });

  // formation fall rate (terminal of the centre path) → fall-rate warnings (§9.5)
  const vForm = Math.abs(path.velocities[path.velocities.length - 1]?.y ?? 50);
  members.forEach((m) => {
    const w = fallRateMismatch(vForm, m.mass, (m.j as any).suitType);
    m.track.fallWarning = w ? w.text : null;
  });

  // ---------------------------------------------------------------- windows (§8.3)
  const windows: SequenceWindow[] = [];
  const workingEnd = S.workingTimeS === "auto" ? tBreak : Math.min(tGo + S.workingTimeS, tBreak);
  const allPiece = members.every((m) => m.piece);
  let firstLen: number;
  // auto with divers: point 1 lasts until it's built (+ hold), at most until breakoff
  const buildUntilKeyed = S.firstPointS === "auto" && !members.every((m) => m.piece);
  if (S.firstPointS !== "auto") firstLen = S.firstPointS;
  else if (allPiece) firstLen = Math.max(S.timePerPointS, SEEK.EXIT_PIECE_DOCK_S + S.minHoldS);
  else {
    let worst = 0;
    for (const m of members) {
      if (m.piece) continue;
      const p = m.j.plane as SimPlane;
      const dtx = m.exitTime - tGo;
      const vgap = 53 * dtx + (p.offset?.upM ?? 0);
      const hgap = p.speed * dtx + Math.hypot(p.offset?.backM ?? 0, p.offset?.rightM ?? 0) + offs[0][m.slot].length();
      worst = Math.max(worst, Math.max(vgap / 15, hgap / 12) + SEEK.EXIT_STABLE_S + SEEK.SETUP_DOCK_S + 4);
    }
    firstLen = Math.ceil(dtMax(members, tGo) + worst + S.minHoldS);
  }
  let round = 1;
  let k = 0;
  const openWindow = (start: number, first: boolean) => {
    const len = first ? firstLen : S.timePerPointS;
    const lastHeld = !S.repeat && k === P - 1;
    windows.push({ point: k, round, start, end: lastHeld ? tBreak : Math.min(start + len, tBreak), keyedAt: null, scored: false, missingSlots: [] });
  };
  openWindow(tGo, true);

  const C = new THREE.Vector3();
  const CV = new THREE.Vector3();
  const nextWindow = (t: number) => {
    const w = windows[windows.length - 1];
    w.end = Math.min(w.end, t);
    w.missingSlots = members.filter((m) => !(m.state === "docked" && m.point === w.point)).map((m) => m.slot + 1);
    if (!S.repeat && k === P - 1) return false;
    k = (k + 1) % P;
    if (k === 0) round++;
    openWindow(t, false);
    // docked members release and move to the new slot
    for (const m of members) {
      if (!m.started || m.ended) continue;
      if (m.state === "docked" || m.state === "transition") {
        const to = offs[k][m.slot];
        const d = m.offset.distanceTo(to);
        m.easeFrom = m.offset.clone();
        m.easeTo = to.clone();
        m.easeT0 = t;
        m.easeDur = Math.max(0.8, d / SEEK.TRANSITION_SPEED_MS + SEEK.TRANSITION_DOCK_S);
        m.easeToPoint = k;
        setState(m, "transition", t);
      } else if (m.state === "setup" || m.state === "dock") {
        setState(m, "approach", t);
        m.passedOuter = true;
      }
    }
    return true;
  };

  function setState(m: Member, s: SeekState, t: number) {
    if (m.state === s && m.track.states.length) return;
    m.state = s;
    m.track.states.push({ t, state: s, point: s === "docked" ? m.point : k });
    if (s === "setup") m.setupSince = t;
  }

  const dockedIn = (slot: number, point: number) => members.some((o) => o.slot === slot && o.state === "docked" && o.point === point);

  // ---------------------------------------------------------------- lockstep
  const steps = Math.floor((tBreak - tGo) / step + 1e-9);
  for (let i = 0; i <= steps; i++) {
    const t = tGo + i * step;
    const g = samplePath(path, t);
    C.copy(g.position);
    CV.copy(g.velocity);
    let w = windows[windows.length - 1];

    for (const m of members) {
      if (m.ended) continue;
      if (t < m.exitTime - 1e-9) continue;
      if (!m.started) {
        m.started = true;
        m.track.t0 = t;
        const ex = exitState(m.j);
        m.pos.copy(ex.pos);
        m.vel.copy(ex.vel);
        m.heading = headingOf(m.vel.x, m.vel.z);
        if (m.piece) {
          m.easeFrom = m.pos.clone().sub(C);
          m.easeT0 = t;
          m.easeDur = SEEK.EXIT_PIECE_DOCK_S;
          m.easeTo = null; // the current point's slot
          setState(m, "transition", t);
        } else setState(m, "exit", t);
      }

      const s = offs[k][m.slot];
      const sh = tmp.set(s.x, 0, s.z);
      const R = radius[k];
      let side = new THREE.Vector3();
      let adjustArea = m.area;
      let limit = false;

      if (m.state === "docked" || m.state === "transition") {
        // ---- kinematic in the formation frame
        if (m.state === "transition" && m.easeFrom) {
          const to = m.easeTo ?? offs[k][m.slot];
          const a = smoothstep((t - m.easeT0) / m.easeDur);
          const prev = m.offset.clone();
          m.offset.copy(m.easeFrom).lerp(to, a);
          m.offsetRate.copy(m.offset).sub(prev).divideScalar(step);
          if (t - m.easeT0 >= m.easeDur) {
            m.point = m.easeTo ? m.easeToPoint : k;
            m.offset.copy(to);
            m.offsetRate.set(0, 0, 0);
            setState(m, "docked", t);
            m.track.dockTimes.push({ window: windows.length - 1, t });
          }
        } else m.offsetRate.set(0, 0, 0);
        m.pos.copy(C).add(m.offset);
        m.vel.copy(CV).add(m.offsetRate);
        side.set(m.offsetRate.x, 0, m.offsetRate.z);
        // the area that falls at the formation's rate, within their range (§9.8)
        const hold = areaFor(Math.abs(CV.y), m.mass);
        limit = hold < m.range.min || hold > m.range.max;
        adjustArea = Math.min(m.range.max, Math.max(m.range.min, hold));
        const target = seq.slotHeadingDeg(m.state === "docked" ? m.point : k, m.slot, frame);
        m.heading = turnToward(m.heading, target, 180 * step);
      } else {
        // ---- free flight
        const r = m.pos.clone().sub(C);
        const rh = new THREE.Vector3(r.x, 0, r.z);
        const u = m.vel.clone().sub(CV);
        const uh = new THREE.Vector3(u.x, 0, u.z);
        const sLen = sh.length();
        const sdir = sLen > 0.3 ? sh.clone().divideScalar(sLen) : rh.lengthSq() > 0.01 ? rh.clone().normalize() : frame.right.clone();
        const setupPt = sh.clone().addScaledVector(sdir, SEEK.SETUP_DIST_M);
        const outer = sdir.clone().multiplyScalar(R + SEEK.OUTER_MARGIN_M);
        const near = rh.length() < R + SEEK.NO_LOW_MARGIN_M;
        if (r.y < -SEEK.LOW_TOL_M && near) m.lowGuard = true;
        else if (r.y > -0.3 || !near) m.lowGuard = false;
        const lowNear = m.lowGuard;

        let wp: THREE.Vector3;
        let yTarget = SEEK.SETUP_HIGH_M;
        if (m.state === "holdoff") {
          wp = sdir.clone().multiplyScalar(R + (m.holdLow ? SEEK.LOW_STANDOFF_M : SEEK.OUTER_MARGIN_M));
          yTarget = m.holdLow ? 50 : 0; // low: slow down as much as possible
        } else if (lowNear) {
          wp = sdir.clone().multiplyScalar(R + SEEK.LOW_STANDOFF_M); // stay out from under the formation
          yTarget = 0;
        } else if (m.state === "dock") {
          wp = sh.clone();
          yTarget = 0;
        } else if (m.state === "setup") {
          wp = setupPt;
        } else {
          const outside = rh.length() >= R + 1 && rh.clone().normalize().dot(sdir) >= Math.cos(Math.PI / 4);
          if (outside) m.passedOuter = true; // committed to the set-up point
          if (m.passedOuter) wp = setupPt;
          else {
            wp = outer;
            if (rh.distanceTo(outer) < 2) m.passedOuter = true;
          }
        }
        const d = wp.clone().sub(rh);
        const dist = d.length();
        const e = r.y - yTarget;
        const exitStable = t - m.exitTime >= SEEK.EXIT_STABLE_S;

        // state changes
        if (m.state === "exit" && exitStable) setState(m, "dive", t);
        if (m.state === "dive" || m.state === "approach") {
          const far = Math.abs(e) > SEEK.DIVE_HIGH_M || dist > SEEK.DIVE_FAR_M;
          setState(m, far ? "dive" : "approach", t);
          if (wp === setupPt && dist < 0.5 && uh.length() < 0.5 && Math.abs(e) < 1) setState(m, "setup", t);
        } else if (m.state === "setup") {
          const ps = partners[k][m.slot];
          const gripped = !ps.length || ps.some((p) => dockedIn(p, k)) || t - m.setupSince >= SEEK.PARENT_WAIT_S;
          if (gripped) setState(m, "dock", t);
        } else if (m.state === "dock") {
          if (rh.distanceTo(sh) < SEEK.DOCK_TOL_M && u.length() < SEEK.DOCK_TOL_V && Math.abs(r.y) < 2 * SEEK.DOCK_TOL_M) {
            m.point = k;
            m.offset.set(s.x, 0, s.z);
            m.offsetRate.set(0, 0, 0);
            setState(m, "docked", t);
            m.track.dockTimes.push({ window: windows.length - 1, t });
          }
        }

        // feasibility every 0.5 s (§9.6)
        if (m.state !== "exit" && m.state !== "holdoff" && m.state !== "docked" && t - m.lastFeasible >= 0.5) {
          m.lastFeasible = t;
          // the formation reaches terminal soon, so judge the climb back against that
          const vf = Math.max(Math.abs(CV.y), vForm);
          const ey = r.y;
          let tV = 0;
          if (ey < -SEEK.LOW_TOL_M) {
            const rise = vf - terminalMs(m.range.max, m.mass);
            tV = rise > 0.2 ? -ey / rise : Infinity;
          } else if (ey > 0) tV = ey / Math.max(1, terminalMs(SEEK.DIVE_AREA_M2, m.mass) - vf);
          const pathLen = rh.distanceTo(wp) + (wp === setupPt ? 0 : wp.distanceTo(setupPt)) + SEEK.SETUP_DIST_M;
          const tH = Math.max(0, pathLen - SEEK.DIVE_FAR_M) / SEEK.V_H_DIVE + Math.min(pathLen, SEEK.DIVE_FAR_M) / SEEK.V_H_BELLY;
          const closing = m.state === "setup" || m.state === "dock";
          const tNeed = closing ? rh.distanceTo(sh) / SEEK.DOCK_SPEED_MS + 1 + (m.state === "setup" ? SEEK.PARENT_WAIT_S : 0) : Math.max(tV, tH) + SEEK.SETUP_DOCK_S;
          if (t + tNeed > tBreak) {
            m.holdLow = ey < -SEEK.LOW_TOL_M;
            m.track.missed = m.holdLow
              ? { kind: "low", detail: `low by ${Math.round(-ey)} m` }
              : { kind: "far", detail: `${Math.round(rh.distanceTo(sh))} m away` };
            if (m.track.fallWarning && m.holdLow) m.track.missed = { kind: "fallRate", detail: m.track.fallWarning };
            setState(m, "holdoff", t);
          } else if (t + tNeed > w.end) m.lateWindows.add(windows.length - 1);
        }

        if (m.state === "exit") {
          // plain freefall with the exit throw (as SimJumper does)
          const wv = windAtHeight(wind, m.pos.y);
          const rel = m.vel.clone().sub(wv);
          const sp = rel.length();
          const acc = rel.multiplyScalar((-K_DRAG * m.area * sp) / m.mass).add(new THREE.Vector3(0, -9.81, 0));
          m.vel.addScaledVector(acc, step);
          adjustArea = m.area;
        } else {
          // vertical: drag area for the wanted relative fall rate (with braking)
          const ae = Math.abs(e);
          const uyWant = ae < 0.05 ? 0 : -Math.sign(e) * Math.min(SEEK.V_V_MAX, Math.sqrt(2 * SEEK.A_FLARE * ae));
          // the area whose drag gives the wanted vertical acceleration at this speed
          const vDown = -(CV.y + uyWant);
          const sNow = Math.max(1, -m.vel.y);
          const aDown = (vDown - sNow) / SEEK.FALL_TAU_S;
          const want = (m.mass * (9.81 - aDown)) / (K_DRAG * sNow * sNow);
          const lo = m.state === "dive" ? SEEK.DIVE_AREA_M2 : m.range.min;
          const hi = m.range.max;
          const target = Math.min(hi, Math.max(lo, want));
          // red only when they can't hold the formation's fall rate at all (§9.8)
          const holdArea = areaFor(Math.abs(CV.y), m.mass);
          limit = m.state !== "dive" && (holdArea < m.range.min || holdArea > m.range.max);
          m.area += (target - m.area) * Math.min(1, step / SEEK.BODY_TAU_S);
          m.vel.y += verticalAccel(m.vel.y, m.area, m.mass) * step;
          // horizontal: a relative velocity toward the waypoint, braking on arrival
          const vmax = m.state === "dive" ? SEEK.V_H_DIVE : m.state === "dock" ? SEEK.DOCK_SPEED_MS : SEEK.V_H_BELLY;
          const want_h = dist > 1e-3 ? d.clone().multiplyScalar(Math.min(vmax, Math.sqrt(2 * SEEK.A_H_BRAKE * dist)) / dist) : new THREE.Vector3();
          const du = want_h.sub(uh);
          const maxDu = (m.state === "dive" ? 3 : 1) * SEEK.A_H_MAX * step;
          if (du.length() > maxDu) du.setLength(maxDu);
          uh.add(du);
          m.vel.x = CV.x + uh.x;
          m.vel.z = CV.z + uh.z;
          side = uh.clone();
          adjustArea = m.area;
        }
        m.pos.addScaledVector(m.vel, step);
        // heading: along the slide when moving, else the slot's heading
        const target = uh.length() > 1 ? headingOf(uh.x, uh.z) : seq.slotHeadingDeg(k, m.slot, frame);
        m.heading = turnToward(m.heading, target, 120 * step);

        // low members break off when they reach breakoff altitude (§9.6)
        if (m.pos.y <= breakoffY) {
          m.ended = true;
          m.endTime = t;
        }
      }

      // record
      const n = m.n++;
      if (n * 3 + 2 < m.track.pos.length) {
        m.track.pos[n * 3] = m.pos.x;
        m.track.pos[n * 3 + 1] = m.pos.y;
        m.track.pos[n * 3 + 2] = m.pos.z;
        m.track.vel[n * 3] = m.vel.x;
        m.track.vel[n * 3 + 1] = m.vel.y;
        m.track.vel[n * 3 + 2] = m.vel.z;
        m.track.heading[n] = m.heading;
      }
      if (n % 10 === 0 && m.adjN < m.track.adjust.t.length) {
        const a = m.track.adjust;
        const q = m.adjN++;
        a.t[q] = t;
        a.mph[q] = m.state === "exit" ? 0 : (terminalMs(adjustArea, m.mass) - terminalMs(m.range.neutral, m.mass)) * MS_TO_MPH;
        a.sideX[q] = m.state === "exit" ? 0 : side.x * MS_TO_MPH;
        a.sideZ[q] = m.state === "exit" ? 0 : side.z * MS_TO_MPH;
        a.atLimit[q] = limit ? 1 : 0;
      }
    }

    // completion and window changes
    if (w.keyedAt === null && members.every((m) => m.state === "docked" && m.point === w.point)) w.keyedAt = t;
    if (buildUntilKeyed && windows.length === 1) w.end = w.keyedAt !== null ? Math.min(w.end, w.keyedAt + S.minHoldS) : tBreak;
    const earlyDone = S.advance === "early" && w.keyedAt !== null && t >= w.keyedAt + S.minHoldS;
    if ((t >= w.end - 1e-9 || earlyDone) && t < tBreak - step) nextWindow(t);
  }

  // finish windows and the score (§8.5)
  const last = windows[windows.length - 1];
  last.end = Math.min(last.end, tBreak);
  last.missingSlots = members.filter((m) => !(m.state === "docked" && m.point === last.point)).map((m) => m.slot + 1);
  windows.forEach((win) => {
    const inter = seq.points[win.point]?.inter;
    win.scored = !inter && win.keyedAt !== null && win.keyedAt + S.minHoldS <= win.end + 1e-6 && win.keyedAt + S.minHoldS <= workingEnd + 1e-6;
    if (win.keyedAt !== null) win.missingSlots = [];
  });
  const score = windows.filter((w2) => w2.scored).length;

  // finish tracks
  const tracks = new Map<SimJumper, MemberTrack>();
  for (const m of members) {
    m.track.endTime = m.ended ? m.endTime : tBreak;
    const pt = m.point >= 0 ? m.point : k;
    const off = offs[pt][m.slot];
    const out = new THREE.Vector3(off.x, 0, off.z);
    if (m.state !== "docked") out.set(m.pos.x - C.x, 0, m.pos.z - C.z);
    m.track.breakoffDir.copy(out.lengthSq() > 1e-6 ? out.normalize() : frame.right);
    // trim to what was recorded
    const n = Math.max(1, m.n);
    m.track.pos = m.track.pos.slice(0, n * 3);
    m.track.vel = m.track.vel.slice(0, n * 3);
    m.track.heading = m.track.heading.slice(0, n);
    const a = m.track.adjust;
    m.track.adjust = { t: a.t.slice(0, m.adjN), mph: a.mph.slice(0, m.adjN), sideX: a.sideX.slice(0, m.adjN), sideZ: a.sideZ.slice(0, m.adjN), atLimit: a.atLimit.slice(0, m.adjN) };
    tracks.set(m.j, m.track);
  }

  const result: SequenceResult = {
    tGo,
    workingTimeEnd: workingEnd,
    breakoffTime: tBreak,
    windows,
    score,
    members: members.map((m) => ({
      slot: m.slot,
      dockTimes: windows.map((_, wi) => m.track.dockTimes.find((d) => d.window === wi)?.t ?? null),
      missed: m.track.missed ?? (m.lateWindows.size ? { kind: "late", detail: `late for ${m.lateWindows.size} point${m.lateWindows.size > 1 ? "s" : ""}` } : null),
    })),
  };
  return { result, tracks, centreEnd: tBreak };
}

function dtMax(members: { exitTime: number }[], tGo: number) {
  return Math.max(0, ...members.map((m) => m.exitTime - tGo));
}

/** Sample a member track at time t (linear between steps). */
export function sampleMemberTrack(tr: MemberTrack, t: number, pos: THREE.Vector3, vel: THREE.Vector3): number {
  const n = tr.heading.length;
  const f = Math.max(0, Math.min(n - 1, (t - tr.t0) / tr.dt));
  const i = Math.min(n - 2, Math.floor(f));
  if (n < 2 || i < 0) {
    pos.set(tr.pos[0], tr.pos[1], tr.pos[2]);
    vel.set(tr.vel[0], tr.vel[1], tr.vel[2]);
    return tr.heading[0] ?? 0;
  }
  const a = f - i;
  const lerp = (arr: Float64Array, c: number) => arr[i * 3 + c] * (1 - a) + arr[(i + 1) * 3 + c] * a;
  pos.set(lerp(tr.pos, 0), lerp(tr.pos, 1), lerp(tr.pos, 2));
  vel.set(lerp(tr.vel, 0), lerp(tr.vel, 1), lerp(tr.vel, 2));
  const h0 = tr.heading[i];
  const dh = ((tr.heading[i + 1] - h0 + 540) % 360) - 180;
  return (h0 + dh * a + 360) % 360;
}

/** Adjustment at time t (§9.8), or null outside the series. */
export function sampleAdjust(tr: MemberTrack, t: number) {
  const a = tr.adjust;
  const n = a.t.length;
  if (!n || t < a.t[0] - 0.05 || t > tr.endTime) return null;
  const f = Math.max(0, Math.min(n - 1, (t - a.t[0]) / 0.1));
  const i = Math.min(n - 1, Math.round(f));
  return { mph: a.mph[i], sideX: a.sideX[i], sideZ: a.sideZ[i], atLimit: a.atLimit[i] === 1 };
}
