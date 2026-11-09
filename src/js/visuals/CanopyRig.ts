import * as THREE from "three";
import type { SimJumper } from "../classes/SimEntities";
import { canopyDimensions, DeploymentTimes, phaseAt, poseHeading } from "../physics/Canopy";

/**
 * Crude deployment rig drawn with each jumper: pilot chute + bridle, deployment bag,
 * suspension lines and an arched 9-cell ram-air wing sized from the canopy's sq ft.
 *
 * Built in metres in a "trail frame" centred on the jumper: +Y points away from the
 * relative wind (up the lines), +Z is the canopy's heading. The group is scaled by the
 * same factor as the (exaggerated) jumper model so the two read at the same size.
 */

const CELLS = 9;
const BODY_LENGTH_M = 1.8;
/** Riser confluence above the jumper's centre (shoulders). */
const RISER_Y = 0.55;
const RISER_HALF_WIDTH = 0.22;
const BRIDLE_M = 2.6;
const PC_RADIUS_M = 0.45;
const CONTAINER_Y = 0.15;
const UP = new THREE.Vector3(0, 1, 0);

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** Flat-bottomed (Clark-Y-ish) airfoil, unit chord, leading edge at x = 0. */
function airfoilShape(thickness: number) {
  const shape = new THREE.Shape();
  const n = 14;
  shape.moveTo(0, 0.02 * thickness);
  for (let i = 1; i <= n; i++) {
    const x = Math.pow(i / n, 1.6);
    const yt =
      5 *
      thickness *
      (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    shape.lineTo(x, 2 * yt);
  }
  shape.lineTo(1, 0);
  shape.lineTo(0.03, 0); // open-ish nose: the inlets sit on the bottom front
  shape.closePath();
  return shape;
}

export class CanopyRig {
  readonly group = new THREE.Group();
  private wing = new THREE.Group();
  private pc: THREE.Mesh;
  private bag: THREE.Mesh;
  private lines: THREE.LineSegments;
  private linePositions: Float32Array;
  private sqft = 0;
  private dims = canopyDimensions(190);
  /** Rib bottoms (A and D attachment points) in wing space, before inflation scaling. */
  private ribPoints: THREE.Vector3[] = [];
  private cellMaterials: THREE.MeshLambertMaterial[];

  constructor(color: THREE.Color, visualScale = 10.4 / BODY_LENGTH_M) {
    this.group.name = "Canopy rig";
    this.group.userData.label = "Canopy";
    this.group.scale.setScalar(visualScale);

    const light = color.clone().lerp(new THREE.Color(0xffffff), 0.55);
    this.cellMaterials = [
      new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }),
      new THREE.MeshLambertMaterial({ color: light, side: THREE.DoubleSide }),
    ];
    this.group.add(this.wing);

    this.pc = new THREE.Mesh(
      new THREE.SphereGeometry(PC_RADIUS_M, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: light, side: THREE.DoubleSide }),
    );
    this.group.add(this.pc);

    this.bag = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.16, 0.26),
      new THREE.MeshLambertMaterial({ color: 0x333333 }),
    );
    this.group.add(this.bag);

    // up to: bridle, 2 bag lines, 2 lines per rib (A + D) and 2 brake lines
    this.linePositions = new Float32Array((1 + 2 + (CELLS + 1) * 2 + 2) * 2 * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(this.linePositions, 3));
    this.lines = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.8 }),
    );
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    this.group.visible = false;
  }

  setVisualScale(scale: number) {
    if (Number.isFinite(scale) && scale > 0) this.group.scale.setScalar(scale);
  }

  setColor(color: THREE.Color) {
    this.cellMaterials[0].color.copy(color);
    this.cellMaterials[1].color.copy(color).lerp(new THREE.Color(0xffffff), 0.55);
    (this.pc.material as THREE.MeshLambertMaterial).color.copy(this.cellMaterials[1].color);
  }

  /** (Re)build the wing when the canopy size changes. */
  private ensureWing(sqft: number) {
    if (sqft === this.sqft) return;
    this.sqft = sqft;
    this.dims = canopyDimensions(sqft);
    const { span, chord, thickness, lineLength } = this.dims;
    this.wing.children.forEach((c) => (c as THREE.Mesh).geometry?.dispose());
    this.wing.clear();

    // cells sit on an arc centred on the riser confluence, radius = line length
    const R = lineLength;
    const halfArc = span / 2 / R;
    const cellWidth = span / CELLS;
    const shape = airfoilShape(thickness / chord);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: cellWidth * 0.97, bevelEnabled: false });
    // shape x (chord) → −Z with the leading edge forward; extrusion → X (span)
    geo.scale(chord, chord, 1);
    geo.rotateY(Math.PI / 2);
    geo.translate(-cellWidth * 0.485, 0, chord * 0.5);
    for (let i = 0; i < CELLS; i++) {
      const phi = -halfArc + ((i + 0.5) / CELLS) * 2 * halfArc;
      const cell = new THREE.Mesh(geo, this.cellMaterials[i % 2]);
      cell.position.set(R * Math.sin(phi), R * Math.cos(phi), 0);
      cell.rotation.z = -phi;
      this.wing.add(cell);
    }
    this.wing.position.set(0, RISER_Y, chord * 0.12); // wing flies slightly ahead

    this.ribPoints = [];
    for (let i = 0; i <= CELLS; i++) {
      const phi = -halfArc + (i / CELLS) * 2 * halfArc;
      const x = R * Math.sin(phi);
      const y = R * Math.cos(phi);
      this.ribPoints.push(new THREE.Vector3(x, y, chord * 0.32)); // A line
      this.ribPoints.push(new THREE.Vector3(x, y, -chord * 0.3)); // D line
    }
  }

  private lineCount = 0;
  private addLine(a: THREE.Vector3, b: THREE.Vector3) {
    const o = this.lineCount * 6;
    if (o + 6 > this.linePositions.length) return;
    this.linePositions.set([a.x, a.y, a.z, b.x, b.y, b.z], o);
    this.lineCount++;
  }

  /** Position the rig for a jumper's precalculated sample at sim time t. */
  update(
    jumper: SimJumper,
    sample: { position: THREE.Vector3; velocity: THREE.Vector3; angle: THREE.Quaternion },
    t: number,
  ) {
    const d: DeploymentTimes | null = jumper.deployment;
    const { phase, progress } = phaseAt(d, t);
    const landed = jumper.landTime !== null && t >= jumper.landTime + 2;
    if (phase === "freefall" || landed) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.ensureWing(jumper.canopySize);
    const { chord, lineLength } = this.dims;

    // orientation: lines stream away from the fall direction, settling vertical once open
    const inflation = phase === "canopy" ? smooth(progress) : 0;
    const trail = sample.velocity.lengthSq() > 1e-4 ? sample.velocity.clone().negate().normalize() : UP.clone();
    trail.lerp(UP, inflation).normalize();
    const heading = poseHeading(sample.angle);
    const yaw = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(heading.x, heading.z));
    this.group.quaternion.setFromUnitVectors(UP, trail).multiply(yaw);
    this.group.position.copy(sample.position);

    this.lineCount = 0;
    const riserL = new THREE.Vector3(-RISER_HALF_WIDTH, RISER_Y, 0);
    const riserR = new THREE.Vector3(RISER_HALF_WIDTH, RISER_Y, 0);
    const container = new THREE.Vector3(0, CONTAINER_Y, -0.05);
    const pcPos = new THREE.Vector3();
    const bagPos = new THREE.Vector3();

    if (phase === "pilot-chute") {
      // thrown out to the side, then catches air and lifts the bridle tight
      const p = smooth(progress);
      pcPos.set(0.6 * (1 - p), CONTAINER_Y + 0.3 + (BRIDLE_M - 0.3) * p, 0);
      this.bag.visible = false;
      this.wing.visible = false;
      this.addLine(container, pcPos);
    } else if (phase === "bag") {
      // bag lifts off the back; lines unstow behind it until line stretch
      const p = smooth(progress);
      bagPos.set(0, RISER_Y + lineLength * p + 0.1, 0);
      pcPos.copy(bagPos).add(new THREE.Vector3(0, BRIDLE_M, 0));
      this.bag.visible = true;
      this.wing.visible = false;
      this.addLine(bagPos, pcPos);
      this.addLine(riserL, bagPos);
      this.addLine(riserR, bagPos);
    } else {
      // canopy: inflates from a narrow snivel to full span, then flies
      const s = inflation;
      const sx = 0.22 + 0.78 * s;
      const sz = 0.45 + 0.55 * s;
      const sy = 0.6 + 0.4 * s;
      this.wing.visible = true;
      this.wing.scale.set(sx, sy, sz);
      const top = new THREE.Vector3(0, RISER_Y + lineLength * sy + chord * 0.12, 0);
      // bag + collapsed PC ride on the bridle above and behind the top skin
      bagPos.copy(top).add(new THREE.Vector3(0, 0.9 - 0.4 * s, -chord * 0.4 * s));
      pcPos.copy(bagPos).add(new THREE.Vector3(0, 1.6 - 0.6 * s, -1.2 * s));
      this.bag.visible = true;
      this.addLine(top, bagPos);
      this.addLine(bagPos, pcPos);

      const wingOrigin = this.wing.position;
      const toRig = (p: THREE.Vector3) =>
        new THREE.Vector3(p.x * sx, p.y * sy, p.z * sz).add(wingOrigin);
      for (let i = 0; i < this.ribPoints.length; i++) {
        const p = toRig(this.ribPoints[i]);
        this.addLine(p.x < 0 ? riserL : riserR, p);
      }
      // brake lines from the outer trailing edges
      const tail = (i: number) => {
        const a = this.ribPoints[i * 2 + 1];
        return toRig(new THREE.Vector3(a.x, a.y, -chord * 0.5));
      };
      this.addLine(riserL, tail(1));
      this.addLine(riserR, tail(CELLS - 1));
    }

    this.pc.position.copy(pcPos);
    this.pc.scale.setScalar(phase === "canopy" ? 1 - 0.45 * inflation : 0.6 + 0.4 * smooth(progress * 2));
    this.bag.position.copy(bagPos);

    const attr = this.lines.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, this.lineCount * 2);
  }

  dispose() {
    this.group.removeFromParent();
    this.wing.children.forEach((c) => (c as THREE.Mesh).geometry?.dispose());
    this.lines.geometry.dispose();
  }
}

const rigs = new Map<SimJumper, CanopyRig>();

function colorOf(jumper: SimJumper): THREE.Color {
  const mat = (jumper.getMesh() as THREE.Mesh)?.material as THREE.MeshBasicMaterial | undefined;
  return mat?.color ? mat.color.clone() : new THREE.Color(0xf5c518);
}

/** Model length ÷ real body length, so the rig matches the exaggerated jumper. */
function visualScaleOf(jumper: SimJumper): number {
  const mesh = jumper.getMesh() as THREE.Mesh;
  const geo = mesh?.geometry as THREE.BufferGeometry | undefined;
  if (!geo) return 10.4 / BODY_LENGTH_M;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.y, size.z) * mesh.scale.x;
  // the placeholder sphere before the STL loads is tiny; keep the default then
  return length > 2 ? length / BODY_LENGTH_M : 10.4 / BODY_LENGTH_M;
}

/** Create, update and retire one rig per jumper. Call whenever the scene time changes. */
export function updateCanopyRigs(scene: THREE.Scene, jumpers: SimJumper[], t: number) {
  const live = new Set(jumpers);
  for (const [j, rig] of rigs) {
    if (!live.has(j)) {
      rig.dispose();
      rigs.delete(j);
    }
  }
  for (const j of jumpers) {
    const sample = j.track.getInterpolatedSample(t);
    let rig = rigs.get(j);
    if (!sample) {
      if (rig) rig.group.visible = false;
      continue;
    }
    if (!rig) {
      rig = new CanopyRig(colorOf(j), visualScaleOf(j));
      rigs.set(j, rig);
      scene.add(rig.group);
    } else if (rig.group.userData.meshId !== j.getMesh()?.id) {
      // the STL model replaced the placeholder: pick up its colour and size
      rig.setVisualScale(visualScaleOf(j));
      rig.setColor(colorOf(j));
    }
    rig.group.userData.meshId = j.getMesh()?.id;
    rig.update(j, sample, t);
  }
}
