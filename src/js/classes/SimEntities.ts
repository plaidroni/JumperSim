import * as THREE from "three";
import { Plane, Jumper } from "./BaseEntities";
import { KinematicTrack } from "../Kinematics";
import { currentWindProfile, windAtHeight } from "../wind/WindProfile";
import { clamp } from "three/src/Three.TSL.js";
import { Formation } from "./Formations"; // add this import
import { getGroundHeight } from "../terrain/GroundHeight";
import {
  AIR_DENSITY,
  BODY_POSITIONS,
  DRAG_COEFFICIENT,
  GLIDE_TAU_S,
  TRACK_SPEC,
  TRACK_START_FT,
  normalizeBodyPosition,
} from "../physics/BodyPositions";
import {
  DEFAULT_FORMATION_SHAPE,
  FORMATION_DOCK_S,
  FormationShapeId,
} from "../physics/FormationShapes";
import {
  GroupPath,

  flockPlanFor,
  formationPath,
  formationPlanFor,
  roundSettingsOf,
  samplePath,
  smoothstep,
} from "../physics/FormationFlight";
import { breakoffDistance, MIN_DEPLOY_SEPARATION_M } from "../physics/FormationShapes";
import { FLOCK_DOCK_S, fanAngleDeg, flockSlotLabel } from "../physics/FlockShapes";
import { TRACKING_EXIT_DELAY_S } from "../physics/BodyPositions";
import { getPlanContext, invalidatePlanContext } from "../dropzone/PlanContext";
import { CanopyGuidance, type CanopyPhase } from "../physics/CanopyGuidance";
import { FreefallGuidance } from "../physics/FreefallGuidance";
import { hazardAt, landingZoneAt, zoneAt } from "../physics/Hazards";
import { rotateHeading } from "../physics/Steering";
import { computeSeparation } from "../physics/Separation";
import {
  CANOPY,
  CanopyPerformance,
  DEFAULT_PULL_FT,
  DEPLOY,
  DeploymentTimes,
  NAV,
  SQFT_PER_M2,
  canopyPerformance,
  canopyPose,
  deploymentTimes,
  exitWeightKg,
  headingQuaternion,
  phaseAt,
  poseHeading,
  turnToward,
} from "../physics/Canopy";

const v_grav = new THREE.Vector3(0, -9.81, 0);
const drag_air = 0.2;
const p_air_start = 0.82;
const area = 1.84 * 0.4;
const mass = 80;

export class SimPlane extends Plane {
  track: KinematicTrack;
  formations: Formation[] = [];
  jumpers: SimJumper[] = [];
  /** What linked groups fly between exit and breakoff (Plane Settings). */
  linkedFormation: FormationShapeId = DEFAULT_FORMATION_SHAPE;
  // UI state holder, assigned at runtime to avoid circular imports
  planeLoad?: any;

  constructor(
    position: THREE.Vector3,
    speedKnots: number,
    direction: THREE.Vector3
  ) {
    super(position, speedKnots, direction);
    this.track = new KinematicTrack();
  }

  addFormation(formation: Formation) {
    this.formations.push(formation);
  }

  precalculate(duration: number, step = 0.1) {
    console.log("Calculating Plane Vector");

    const originalPosition = this.position.clone();

    this.track.samples = [];
    for (let t = 0; t <= duration; t += step) {
      super.update(t);
      // derive yaw quaternion from direction vector (assumes +Z forward)
      const yaw = Math.atan2(this.direction.x, this.direction.z);
      const quat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        yaw
      );
      this.track.addSample(t, this.position, this.vector, quat);
    }
    this.position.copy(originalPosition);
    if (this.mesh) this.mesh.position.copy(originalPosition);
    console.log("Calculating Formation Vectors");
  }

  getFormationsSummary() {
    return this.formations.map((f: any) => ({
      id: f?.id,
      name: f?.name,
      size: f?.members ? f.members.length : undefined,
      // add other fields if your Formation type exposes them (e.g., anchor, slots)
    }));
  }

  buildLoadPanelData(jumpers: SimJumper[]) {
    const jumpersSorted = [...jumpers].sort((a, b) => a.index - b.index);
    const jumperSummaries = jumpersSorted.map((j) => j.toEditableSummary());
    return {
      plane: this.toLoadPanelSummary(jumpersSorted),
      formations: this.getFormationsSummary(),
      jumpers: jumperSummaries,
      loadOrder: jumperSummaries.map((j) => j.id),
    };
  }
}

export class SimJumper extends Jumper {
  track: KinematicTrack;
  formationOffset: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  origin: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  hasLanded: boolean;
  hasJumped: boolean;
  angle: THREE.Quaternion = new THREE.Quaternion();
  // Debug: arrow indicating intended tracking direction
  debugArrow: THREE.ArrowHelper | null = null;
  debugArrowColor: number = 0x00ff00;
  /** Sim time the jumper started tracking (null if they never track). Set by precalculate. */
  trackStartTime: number | null = null;
  /** Sim time the jumper landed (null if not within the precalculated window). */
  landTime: number | null = null;
  /** Sim time the jumper's formation breaks off (null when flying solo). */
  formationEndTime: number | null = null;
  /** Status text while in formation, e.g. "In round". */
  formationStatus: string | null = null;
  /** Pull → bag → line stretch → open times (null if they never pull). Set by precalculate. */
  deployment: DeploymentTimes | null = null;
  /** Steady canopy flight numbers for this jumper's exit weight and canopy. */
  canopyPerf: CanopyPerformance | null = null;
  /** Peak deceleration during the opening, in g. */
  openingPeakG = 0;
  /** Height (m above the DZ) at full open. */
  openAltitudeM: number | null = null;
  /** Canopy navigation phase changes ({ t, phase }), in time order. */
  canopyPhases: { t: number; phase: CanopyPhase }[] = [];
  /** Alternate LZ name when the primary pattern couldn't be reached. */
  canopyAlternate: string | null = null;
  /** Danger-zone violations under canopy. */
  hazardEvents: { zoneId: string; name: string; start: number; end: number; minHeightFt: number }[] = [];
  landingOutcome: { kind: "lz" | "out" | "hazard"; name?: string; id?: string } | null = null;
  /** Freefall pattern being flown (name), lane, leg start times and leg count. */
  freefallRoute: { name: string; lane: number; legTimes: number[]; legCount: number; kind: string } | null = null;
  deployOutsideArea = false;
  /** Round: 1-based slot, breakoff distance (m) and when the member stopped tracking. */
  roundSlot: number | null = null;
  breakoffDistanceM: number | null = null;
  breakoffHoldTime: number | null = null;
  /** Flock: slot label ("Base", "R1"…), and when it broke off. */
  flockSlotLabel: string | null = null;
  flockDockedTime: number | null = null;
  flockBreakoffTime: number | null = null;
  /** Nearest other jumper at this jumper's pull (from Separation.ts). */
  pullSeparation: { distanceM: number; otherId: string } | null = null;

  constructor(
    index: number,
    plane: SimPlane,
    jumpInterval: number,
    deployDelay: number,
    canopySize: number
  ) {
    super(index, plane, jumpInterval, deployDelay, canopySize);
    this.track = new KinematicTrack();
    this.velocity = plane.vector.clone();
    this.hasJumped = false;
    this.hasLanded = false;
  }

  addLandingSpot() {}

  precalculate(duration: number, step = 0.01) {
    this.track.samples = [];
    let timeSinceJump = 0;

    const g = 9.81;
    const rho0 = AIR_DENSITY; // kg/m^3 (constant; see physics/BodyPositions.ts)
    const Cd = DRAG_COEFFICIENT;
    this.calculateSurfaceArea(); // keep area in sync with the body position
    const position = normalizeBodyPosition(this.flyingStyle);
    const spec = BODY_POSITIONS[position];
    const isWingsuit = position === "wingsuit";
    const tracks = this.tracking && spec.canTrack;
    const mass = this.weight + this.extraWeight;
    this.trackStartTime = null;
    this.landTime = null;
    this.hasLanded = false;
    if (this.debugArrow) (this.debugArrow as any).visible = false;

    const knotsToMs = (knots: number) => knots * 0.514444;

    // Same profile the wind tower draws: metres above the DZ, downwind vectors,
    // +X east / -Z north (see wind/WindProfile.ts)
    const windProfile = currentWindProfile();

    console.log(
      `Calculating Jumper Vector for ${this.index} in formation: ${this.isInFormation}`
    );

    // ----- helpers -----
    const feetToMeters = (ft: number) => ft * 0.3048;
    const metersToFeet = (m: number) => m / 0.3048;

    // simple ISA-like exponential falloff for density (h in meters)
    function rhoAt(hMeters: number) {
      const scale = 8000.0; // scale height ~ 8000 m
      return rho0 * Math.exp(-hMeters / scale);
    }

    // Exponential smoothing helper for wind (in m/s)
    const windSmoothingTau = 0.5; // seconds, tweakable (smaller = less smoothing)
    let windPrev = new THREE.Vector3(0, 0, 0);

    function windVectorAt(altitudeMeters: number): THREE.Vector3 {
      return windAtHeight(windProfile, altitudeMeters);
    }

    const planeSampleAtJump = (
      this.plane as SimPlane
    ).track.getInterpolatedSample(this.jumpTime);
    let currentPosition = planeSampleAtJump
      ? planeSampleAtJump.position.clone().add(this.origin)
      : this.plane.position.clone().add(this.origin);
    // Tracking / gliding parameters
    const trackingStartAltitudeM = feetToMeters(TRACK_START_FT);
    let trackingStarted = false;
    const glideBlend = 1 - Math.exp(-step / GLIDE_TAU_S);
    // Determine the intended horizontal tracking direction
    const jumpRunDir = new THREE.Vector3(
      this.plane.direction.x,
      0,
      this.plane.direction.z
    ).normalize();
    const defaultPerp = new THREE.Vector3(-jumpRunDir.z, 0, jumpRunDir.x);
    let trackingDir = defaultPerp.clone();
    if (trackingDir.lengthSq() < 1e-6) trackingDir.set(1, 0, 0);
    // If in a formation with other members, compute outward from formation center using initial origins
    if (this.isInFormation && (this as any).formation) {
      const formation = (this as any).formation;
      const allJumpers: SimJumper[] = (
        (this.plane as SimPlane).jumpers || []
      ).filter((j: any) => j && (j as any).formation === formation);
      const S = allJumpers.length;
      // Establish a stable per-formation index for alternating directions
      const localOrder = [...allJumpers].sort(
        (a, b) => a.index - b.index || (a.id > b.id ? 1 : -1)
      );
      const localIndex = Math.max(
        0,
        localOrder.findIndex((x) => x.id === (this as any).id)
      );
      if (S >= 3) {
        const center = allJumpers.reduce(
          (acc, j) => {
            acc.x += j.origin.x;
            acc.z += j.origin.z;
            return acc;
          },
          { x: 0, z: 0 }
        );
        center.x /= S;
        center.z /= S;
        let dirX = this.origin.x - center.x;
        let dirZ = this.origin.z - center.z;
        let mag = Math.hypot(dirX, dirZ);
        if (mag < 1e-6) {
          // Fallback: derive a radial direction using per-formation index
          const theta = (2 * Math.PI * localIndex) / S;
          dirX = Math.cos(theta);
          dirZ = Math.sin(theta);
          mag = 1;
        }
        trackingDir.set(dirX / mag, 0, dirZ / mag);
      } else if (S === 2) {
        // Two-way: opposite directions perpendicular to jumprun
        const sign = localIndex === 0 ? 1 : -1;
        trackingDir.copy(defaultPerp).multiplyScalar(sign).normalize();
      } else {
        // Solo within 'formation' (edge): perpendicular default
        trackingDir.copy(defaultPerp).normalize();
      }
    } else {
      // Not in formation: perpendicular to jumprun
      trackingDir.copy(defaultPerp).normalize();
    }
    this.velocity = planeSampleAtJump
      ? planeSampleAtJump.velocity.clone()
      : this.plane.vector.clone();

    // Formation flying (linked groups): follow the group's shared path, closing into
    // this jumper's slot after exit, until breakoff. Then track radially outward.
    const formation = formationPlanFor(this, this.plane as SimPlane);
    let groupPath: GroupPath | null = null;
    let slot: THREE.Vector3 | null = null;
    const exitOffset = this.origin.clone().setY(0);
    let facing: THREE.Quaternion | null = null;
    this.formationEndTime = null;
    this.formationStatus = null;
    if (formation) {
      slot = formation.plan.slots[formation.slotIndex].clone();
      groupPath = formationPath(
        formation.plan,
        this.plane as SimPlane,
        windProfile,
        step,
        duration,
        trackingStartAltitudeM
      );
      this.formationEndTime = groupPath.endTime;
      this.formationStatus = formation.plan.shape.statusLabel || null;
      if (slot.lengthSq() > 1e-6) {
        trackingDir.copy(slot).setY(0).normalize(); // breakoff: straight out from the centre
        facing = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          Math.atan2(-slot.x, -slot.z) // face the centre
        );
      }
    }

    // ----- dropzone plan: patterns, lanes, zones -----
    const pctx = getPlanContext(this.plane as SimPlane, windProfile);
    const glidesFromExit = spec.glidesFromExit;
    const isTrackingJump = position === "tracking";
    const roundSettings = roundSettingsOf(this.plane as SimPlane);
    this.roundSlot = formation ? formation.slotIndex + 1 : null;
    this.breakoffDistanceM = null;
    this.breakoffHoldTime = null;
    let breakoffCentre: THREE.Vector3 | null = null;
    let breakoffHeld = false;
    if (formation && groupPath) {
      const last = groupPath.positions[groupPath.positions.length - 1];
      breakoffCentre = last.clone();
      this.breakoffDistanceM = breakoffDistance(
        formation.plan.members.length,
        roundSettings,
        (this.plane as any).minDeploySeparationM ?? MIN_DEPLOY_SEPARATION_M
      );
    }

    // wingsuit flocks: the base flies the pattern, followers hold a slot off the base
    const flock = isWingsuit ? flockPlanFor(this, this.plane as SimPlane) : null;
    const flockBase = flock && flock.slotIndex > 0 ? flock.base : null;
    this.flockSlotLabel = flock ? flockSlotLabel(flock.settings, flock.slotIndex) : null;
    this.flockDockedTime = null;
    this.flockBreakoffTime = null;
    const flockBreakoffY = flock ? feetToMeters(flock.settings.breakoffFt) : -Infinity;
    const flockEnd = flockBase
      ? Math.min(
          flockBase.flockBreakoffTime ?? Infinity,
          flockBase.deployment?.pullTime ?? Infinity,
          flockBase.landTime ?? Infinity
        )
      : -Infinity;
    let flockExitOffset: THREE.Vector3 | null = null;

    // freefall pattern (trackers, wingsuit bases and solo wingsuiters)
    let ffGuidance: FreefallGuidance | null = null;
    this.freefallRoute = null;
    this.deployOutsideArea = false;
    if (glidesFromExit && !flockBase) {
      const r = pctx.routeFor(this);
      if (r) {
        ffGuidance = new FreefallGuidance(r.route, isWingsuit ? "wingsuit" : "tracking");
        this.freefallRoute = {
          name: r.route.pattern.name,
          lane: r.lane,
          legTimes: ffGuidance.legStartTimes,
          legCount: ffGuidance.legCount,
          kind: r.route.pattern.kind,
        };
        // head for the first leg from exit rather than perpendicular to jumprun
        const first = r.route.legs[0];
        if (first) {
          const d = new THREE.Vector3(first.point.x - currentPosition.x, 0, first.point.z - currentPosition.z);
          if (d.lengthSq() > 1) trackingDir.copy(d.normalize());
        }
      }
    }

    // ----- deployment + canopy -----
    const pullAltM = feetToMeters(this.pullAltitudeFt ?? DEFAULT_PULL_FT);
    const exitKg = exitWeightKg(this.weight, this.extraWeight);
    const perf = canopyPerformance(exitKg, this.canopySize);
    const fullCanopyDragArea = CANOPY.resultantCoeff * (this.canopySize / SQFT_PER_M2);
    // everyone deploys flat and stable (a wingsuit's lift is gone once it pitches up)
    const deployBodyArea = BODY_POSITIONS.belly.dragAreaM2;
    const surgeBlend = 1 - Math.exp(-step / DEPLOY.surgeTauS);
    const maxTurn = THREE.MathUtils.degToRad(NAV.turnRateDegS) * step;
    this.canopyPerf = perf;
    this.deployment = null;
    this.openingPeakG = 0;
    this.openAltitudeM = null;
    let deploy: DeploymentTimes | null = null;
    const heading = jumpRunDir.clone();
    const pullPose = new THREE.Quaternion();
    const openPose = new THREE.Quaternion();

    // Landing pattern: final is flown into the surface wind (or along jump run when
    // calm); each jumper gets their own spot in a small grid around the DZ target.
    const surfaceWind = windVectorAt(10).setY(0);
    const landingHeading =
      surfaceWind.length() > NAV.minWindForFinalMs
        ? surfaceWind.clone().negate().normalize()
        : jumpRunDir.clone();
    const landingCross = new THREE.Vector3(-landingHeading.z, 0, landingHeading.x);
    const planAim = pctx.aimFor(this);
    const landingTarget = planAim
      ? new THREE.Vector3(planAim.x, 0, planAim.z)
      : landingCross
          .clone()
          .multiplyScalar(((this.index % 5) - 2) * 12)
          .addScaledVector(landingHeading, Math.floor(this.index / 5) * 15);

    this.angle.copy(headingQuaternion(jumpRunDir));

    const canopyNav = new CanopyGuidance({
      perf,
      pattern: planAim ? pctx.patternAt(planAim) : null,
      aim: { x: landingTarget.x, z: landingTarget.z },
      landingHeading,
      zones: pctx.zones,
      lzs: pctx.lzs,
      windAt: (y: number) => windVectorAt(y).setY(0),
    });
    this.canopyPhases = [];
    this.canopyAlternate = null;
    this.hazardEvents = [];
    this.landingOutcome = null;
    let openHazard: SimJumper["hazardEvents"][number] | null = null;
    let navHeading: THREE.Vector3 | null = null;

    // Freefall and the opening are sampled every step; settled canopy flight and
    // time in the plane every 0.1 s (the tracks interpolate between samples).
    const coarseEvery = Math.max(1, Math.round(0.1 / step));
    const steps = Math.floor(duration / step + 1e-9);

    for (let i = 0; i <= steps; i++) {
      const simTime = i * step;
      let coarse = false;

      if (simTime < this.jumpTime) {
        coarse = true;
        const sample = (this.plane as SimPlane).track.getInterpolatedSample(
          simTime
        );
        if (sample) {
          currentPosition = sample.position.clone();
          this.velocity = sample.velocity.clone();
        }
      } else {
        this.hasJumped = true;
        timeSinceJump = simTime - this.jumpTime;

        if (groupPath && slot && simTime < groupPath.endTime) {
          // in formation: centre of the group + this jumper's slot (eased in after exit)
          const g = samplePath(groupPath, simTime);
          const dock = smoothstep((simTime - this.jumpTime) / FORMATION_DOCK_S);
          currentPosition = g.position.clone().add(exitOffset.clone().lerp(slot, dock));
          this.velocity = g.velocity.clone();
          if (facing) this.angle.copy(facing);
        } else if (flockBase && flock && simTime < flockEnd) {
          // flock: hold this slot off the base (eased in after this jumper's own exit)
          const b = flockBase.track.getInterpolatedSample(simTime);
          if (b) {
            const h = poseHeading(b.angle);
            const right = new THREE.Vector3(-h.z, 0, h.x);
            const slotOffset = right
              .multiplyScalar(flock.slot.across)
              .addScaledVector(h, -flock.slot.behind)
              .add(new THREE.Vector3(0, -flock.slot.below, 0));
            if (!flockExitOffset) flockExitOffset = currentPosition.clone().sub(b.position);
            const dock = smoothstep((simTime - this.jumpTime) / FLOCK_DOCK_S);
            if (dock >= 1 && this.flockDockedTime === null) this.flockDockedTime = simTime;
            currentPosition = b.position.clone().add(flockExitOffset!.clone().lerp(slotOffset, dock));
            this.velocity = b.velocity.clone();
            this.angle.copy(b.angle);
          }
        } else {
          if (flockBase && flock && this.flockBreakoffTime === null) {
            // flock breakoff: fan away from the base line
            this.flockBreakoffTime = simTime;
            trackingDir.copy(rotateHeading(poseHeading(this.angle), fanAngleDeg(flock.slot)));
          }
          const wind = windVectorAt(currentPosition.y);

          // Pull: the deployment sequence starts and tracking stops
          if (!deploy && currentPosition.y <= pullAltM) {
            deploy = deploymentTimes(simTime);
            this.deployment = deploy;
            pullPose.copy(this.angle);
            poseHeading(this.angle, heading);
            if (ffGuidance) {
              const legs = ffGuidance.route.legs;
              const last = legs[legs.length - 1];
              const radius = ffGuidance.route.pattern.deployRadiusM ?? 150;
              if (last && Math.hypot(currentPosition.x - last.point.x, currentPosition.z - last.point.z) > radius)
                this.deployOutsideArea = true;
            }
          }
          const phase = phaseAt(deploy, simTime);

          if (phase.phase === "freefall") {
            // the flock base marks when the flock breaks off
            if (flock && flock.slotIndex === 0 && this.flockBreakoffTime === null && currentPosition.y <= flockBreakoffY)
              this.flockBreakoffTime = simTime;
            // Tracking jump: track from shortly after exit
            if (isTrackingJump && !trackingStarted && simTime - this.jumpTime >= TRACKING_EXIT_DELAY_S) {
              trackingStarted = true;
              this.trackStartTime = simTime;
            }
            // Break off and track below the breakoff altitude (if this jumper tracks)
            const breakoffY = formation ? feetToMeters(roundSettings.breakoffFt) : trackingStartAltitudeM;
            if (tracks && !trackingStarted && !breakoffHeld && currentPosition.y <= breakoffY) {
              trackingStarted = true;
              this.trackStartTime = simTime;
            }
            // round members stop tracking at their breakoff slot and wave off
            if (
              trackingStarted &&
              !isTrackingJump &&
              breakoffCentre &&
              this.breakoffDistanceM !== null &&
              Math.hypot(currentPosition.x - breakoffCentre.x, currentPosition.z - breakoffCentre.z) >=
                this.breakoffDistanceM
            ) {
              trackingStarted = false;
              breakoffHeld = true;
              this.breakoffHoldTime = simTime;
            }
            const gliding = isWingsuit || trackingStarted;
            if (gliding && ffGuidance) ffGuidance.step(simTime, step, currentPosition, this.velocity.y, wind, trackingDir);
            const A = trackingStarted
              ? TRACK_SPEC.dragAreaM2
              : breakoffHeld || isTrackingJump
                ? BODY_POSITIONS.belly.dragAreaM2
                : spec.dragAreaM2;
            const k = 0.5 * Cd * rho0 * A; // drag = k·v²

            if (!gliding) {
              // Plain freefall: drag opposes the full air-relative velocity, so the exit
              // throw bleeds off naturally while the jumper drifts with the wind.
              const relativeVelocity = this.velocity.clone().sub(wind);
              const speed = relativeVelocity.length();
              const drag = relativeVelocity
                .clone()
                .normalize()
                .multiplyScalar(-k * speed * speed);
              const acceleration = drag
                .divideScalar(mass)
                .add(new THREE.Vector3(0, -g, 0));
              this.velocity.add(acceleration.multiplyScalar(step));
            } else {
              // Gliding (track or wingsuit): drag sets the fall rate from the vertical
              // speed, and the body converts it into forward speed at the glide ratio.
              const vy = this.velocity.y;
              const ay = -g + (k * vy * vy * (vy < 0 ? 1 : -1)) / mass;
              this.velocity.y += ay * step;

              const glide = ffGuidance
                ? ffGuidance.glide
                : isWingsuit
                  ? spec.glideRatio
                  : TRACK_SPEC.glideRatio;
              const horizSpeed = Math.abs(this.velocity.y) * glide;
              const targetX = trackingDir.x * horizSpeed + wind.x;
              const targetZ = trackingDir.z * horizSpeed + wind.z;
              // ease into the new horizontal speed rather than snapping to it
              this.velocity.x += (targetX - this.velocity.x) * glideBlend;
              this.velocity.z += (targetZ - this.velocity.z) * glideBlend;
              // head along the glide direction
              this.angle.slerp(headingQuaternion(trackingDir), glideBlend);
            }
          } else if (phase.phase !== "canopy" || simTime < deploy!.openTime) {
            // Pilot chute → bag → inflation: the body plus whatever is out behind it,
            // as plain drag against the air-relative velocity.
            const sincePull = simTime - deploy!.pullTime;
            let A =
              deployBodyArea +
              DEPLOY.pilotChuteDragAreaM2 * Math.min(1, sincePull / 0.4);
            if (phase.phase !== "pilot-chute") A += DEPLOY.bagDragAreaM2;
            if (phase.phase === "canopy") {
              // snivel: the canopy's area grows slowly at first, then bangs open
              A += fullCanopyDragArea * Math.pow(phase.progress, 2.4);
            }
            const rel = this.velocity.clone().sub(wind);
            const speed = rel.length();
            const drag = rel.multiplyScalar(-0.5 * Cd * rho0 * A * speed);
            const dragG = drag.length() / exitKg / g;
            if (dragG > this.openingPeakG) this.openingPeakG = dragG;
            this.velocity.addScaledVector(
              drag.divideScalar(exitKg).add(v_grav),
              step
            );
            if (phase.phase === "canopy") {
              // swing from flat to hanging under the wing as it inflates
              canopyPose(heading, openPose);
              this.angle.copy(pullPose).slerp(openPose, smoothstep(phase.progress));
            }
          } else {
            // Canopy flight: wing loading sets the airspeed, glide ratio splits it
            // into forward and down; the wind carries the whole thing.
            if (this.openAltitudeM === null) this.openAltitudeM = currentPosition.y;
            const prevPhase = canopyNav.phase;
            // navigation decisions every 0.1 s; the turn itself runs every step
            if (!navHeading || i % coarseEvery === 0) navHeading = canopyNav.desired(currentPosition, wind, simTime);
            turnToward(heading, navHeading, maxTurn);
            if (!this.canopyPhases.length || canopyNav.phase !== prevPhase || this.canopyPhases[this.canopyPhases.length - 1].phase !== canopyNav.phase)
              this.canopyPhases.push({ t: simTime, phase: canopyNav.phase });
            if (canopyNav.alternate) this.canopyAlternate = canopyNav.alternate.lz.name;
            // danger zones below their ceiling (checked every 0.1 s)
            if (i % coarseEvery === 0 && pctx.zones.length) {
              const agl = currentPosition.y - getGroundHeight(currentPosition.x, currentPosition.z);
              const hz = hazardAt(pctx.zones, currentPosition.x, currentPosition.z, agl);
              if (hz && openHazard && openHazard.zoneId === hz.zone.id) {
                openHazard.end = simTime;
                openHazard.minHeightFt = Math.min(openHazard.minHeightFt, agl / 0.3048);
              } else if (hz) {
                openHazard = { zoneId: hz.zone.id, name: hz.zone.name, start: simTime, end: simTime, minHeightFt: agl / 0.3048 };
                this.hazardEvents.push(openHazard);
              } else openHazard = null;
            }

            const groundY = getGroundHeight(currentPosition.x, currentPosition.z);
            const flare = smoothstep((6 - (currentPosition.y - groundY)) / 6);
            const target = heading
              .clone()
              .multiplyScalar(perf.horizontalMs * (1 - 0.55 * flare))
              .setY(-perf.verticalMs * (1 - 0.75 * flare))
              .add(new THREE.Vector3(wind.x, 0, wind.z));
            // surge into steady flight after opening (and on every turn)
            this.velocity.lerp(target, surgeBlend);
            canopyPose(heading, this.angle);
            coarse = simTime > deploy!.openTime + 3 * DEPLOY.surgeTauS && flare === 0;
          }

          currentPosition.add(this.velocity.clone().multiplyScalar(step));

          const groundY = getGroundHeight(currentPosition.x, currentPosition.z);
          if (currentPosition.y < groundY) {
            currentPosition.y = groundY;
            this.velocity.set(0, 0, 0);
            this.hasLanded = true;
            this.landTime = simTime;
            const hz = zoneAt(pctx.zones, currentPosition.x, currentPosition.z);
            const lz = landingZoneAt(pctx.lzs, currentPosition.x, currentPosition.z);
            this.landingOutcome = hz
              ? { kind: "hazard", name: hz.zone.name, id: hz.zone.id }
              : lz
                ? { kind: "lz", name: lz.lz.name, id: lz.lz.id }
                : pctx.lzs.length
                  ? { kind: "out" }
                  : null;
          }
        }
      }

      if (!coarse || i % coarseEvery === 0 || this.hasLanded) {
        this.track.addSample(
          simTime,
          currentPosition.clone(),
          this.velocity.clone(),
          this.angle.clone()
        );
      }
      if (this.hasLanded) break; // the track holds its last sample from here on
    }
    if (this.debugArrow) (this.debugArrow as any).visible = false;
  }
}

/**
 * Precalculate a whole load: flock followers last (they follow their base's track),
 * then the separation check at pull.
 */
export function precalculateJumpers(jumpers: SimJumper[], duration: number) {
  invalidatePlanContext();
  const plane = jumpers[0]?.plane as SimPlane | undefined;
  const isFollower = (j: SimJumper) => {
    const f = plane ? flockPlanFor(j, plane) : null;
    return !!f && f.slotIndex > 0;
  };
  const ordered = [...jumpers].sort((a, b) => Number(isFollower(a)) - Number(isFollower(b)));
  ordered.forEach((j) => j.precalculate(duration));
  computeSeparation(jumpers, (plane as any)?.minDeploySeparationM ?? MIN_DEPLOY_SEPARATION_M);
}

export function createDefaultSimJumpers(
  count: number,
  plane: SimPlane
): SimJumper[] {
  return Array.from(
    { length: count },
    (_, i) => new SimJumper(i, plane, 10, 50, 190)
  );
}
