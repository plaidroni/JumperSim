import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * Camera follow (plane or jumper).
 *
 * While following, the camera is carried along with the target every frame and the
 * orbit pivot sits on it, so you can still orbit and zoom freely — you just orbit
 * around the thing you're following. Panning (right-drag, or Shift/Ctrl + drag)
 * means "look somewhere else", so it stops following.
 *
 * Modes pick where the camera eases to when you start following:
 *  - free:  stay where you are, just keep up with it
 *  - close: fly in close, same viewing angle
 *  - chase: sit behind and a little above it, along its direction of travel (eases
 *           back behind it a moment after you let go of an orbit)
 *  - top:   look straight down on it
 *
 * Switching targets blends the pivot over a short time instead of snapping the view.
 */

export type FollowMode = "free" | "close" | "chase" | "top";

export const FOLLOW_MODES: Array<{ mode: FollowMode; label: string; hint: string }> = [
  { mode: "free", label: "Follow", hint: "Keep this view and follow it" },
  { mode: "close", label: "Close-up", hint: "Fly in close and follow" },
  { mode: "chase", label: "Chase", hint: "Ride behind it along its direction of travel" },
  { mode: "top", label: "Top-down", hint: "Look straight down on it" },
];

export interface FollowDeps {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  viewport: HTMLElement;
  canvas: HTMLElement;
  /** Scene-space velocity of the target (any units/s; only the direction is used). */
  velocityOf?: (obj: THREE.Object3D) => THREE.Vector3 | null;
  /** Called whenever the followed object or mode changes (null name = stopped). */
  onChange?: (name: string | null, mode: FollowMode | null) => void;
}

const PIVOT_BLEND_S = 0.6; // pivot glide when the target changes
const EASE_S = 0.4; // camera ease toward the mode's position (time constant)
const CHASE_RESUME_S = 1.5; // chase eases back behind after an orbit, after this idle
const ONE_SHOT_MAX_S = 2.5; // free/close/top stop steering the camera after this

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export class CameraFollow {
  target: THREE.Object3D | null = null;
  name: string | null = null;
  mode: FollowMode = "free";

  private d: FollowDeps;
  private lastCenter: THREE.Vector3 | null = null;
  private pivotFrom = new THREE.Vector3(); // old pivot, relative to the target centre
  private blend = 1;
  private steer: THREE.Vector3 | null = null; // one-shot offset to ease toward
  private steerAge = 0;
  private userDragging = false;
  private idleSince = 0;
  private heading = new THREE.Vector3(1, 0, 0); // last known horizontal travel direction
  private lastTime = performance.now();
  private chip: HTMLElement;

  constructor(d: FollowDeps) {
    this.d = d;
    d.controls.addEventListener("start", () => {
      this.userDragging = true;
      this.steer = null; // the user takes over the angle/distance
    });
    d.controls.addEventListener("end", () => {
      this.userDragging = false;
      this.idleSince = performance.now();
    });
    // OrbitControls pans with right-drag or a modifier + left-drag: that's "look elsewhere"
    d.canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.target) return;
        if (e.button === 2 || (e.button === 0 && (e.shiftKey || e.ctrlKey || e.metaKey))) this.stop();
      },
      true,
    );
    this.chip = this.buildChip();
  }

  isFollowing(obj?: THREE.Object3D | null) {
    return obj ? this.target === obj : !!this.target;
  }

  follow(obj: THREE.Object3D, opts: { mode?: FollowMode; name?: string | null; offset?: THREE.Vector3 } = {}) {
    const center = this.centerOf(obj);
    const prevPivot = this.d.controls.target.clone();
    const changing = this.target !== obj;
    this.target = obj;
    this.name = opts.name !== undefined ? opts.name : changing ? null : this.name;
    this.mode = opts.mode ?? "free";
    this.lastCenter = center.clone();
    this.steerAge = 0;
    this.idleSince = 0;

    // glide the pivot from where we were looking onto the new target
    if (changing || prevPivot.distanceTo(center) > 1e-3) {
      this.pivotFrom.copy(prevPivot).sub(center);
      this.blend = 0;
    }

    const vel = this.d.velocityOf?.(obj);
    if (vel && vel.setY(0).lengthSq() > 1e-6) this.heading.copy(vel).normalize();

    this.steer = opts.offset ? opts.offset.clone() : this.offsetFor(this.mode, obj, center);
    this.renderChip();
    this.d.onChange?.(this.name, this.mode);
  }

  setMode(mode: FollowMode) {
    if (this.target) this.follow(this.target, { mode, name: this.name });
  }

  stop() {
    if (!this.target) return;
    this.target = null;
    this.lastCenter = null;
    this.steer = null;
    this.blend = 1;
    this.renderChip();
    this.d.onChange?.(null, null);
  }

  /** Per frame (skipped while another camera owns the view, e.g. the planner). */
  update() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const obj = this.target;
    if (!obj) return;
    if (!obj.parent) {
      this.stop(); // removed from the scene
      return;
    }
    const { camera, controls } = this.d;
    const center = this.centerOf(obj);

    // carry the camera along so the target never slides off screen, even mid-orbit
    if (this.lastCenter) camera.position.add(center.clone().sub(this.lastCenter));
    this.lastCenter = center.clone();

    // pivot: glide onto the target, then sit on it
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / PIVOT_BLEND_S);
    const k = easeOutCubic(this.blend);
    controls.target.copy(center).addScaledVector(this.pivotFrom, 1 - k);

    // keep the travel direction fresh for chase view
    const vel = this.d.velocityOf?.(obj);
    if (vel && vel.setY(0).lengthSq() > 1e-6) {
      vel.normalize();
      this.heading.lerp(vel, 1 - Math.exp(-dt / 0.5)).normalize();
    }

    if (!this.userDragging) {
      let desired: THREE.Vector3 | null = null;
      if (this.mode === "chase") {
        const idle = this.idleSince === 0 || now - this.idleSince > CHASE_RESUME_S * 1000;
        if (idle) desired = this.offsetFor("chase", obj, center);
      } else if (this.steer) {
        this.steerAge += dt;
        desired = this.steer;
        const there = camera.position.distanceTo(center.clone().add(desired)) < desired.length() * 0.01;
        if (there || this.steerAge > ONE_SHOT_MAX_S) this.steer = null;
      }
      if (desired) {
        const alpha = 1 - Math.exp(-dt / EASE_S);
        camera.position.lerp(center.clone().add(desired), alpha);
      }
    }
    controls.update();
  }

  // ------------------------------------------------------------------ helpers

  /** Bounds of the object's meshes only (helper lines/sprites attached to it would skew it). */
  private meshBox(obj: THREE.Object3D) {
    obj.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    obj.traverseVisible((o) => {
      const g = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry : null;
      if (!g) return;
      if (!g.boundingBox) g.computeBoundingBox();
      if (g.boundingBox) box.union(part.copy(g.boundingBox).applyMatrix4(o.matrixWorld));
    });
    return box.isEmpty() ? box.setFromObject(obj) : box;
  }

  private centerOf(obj: THREE.Object3D) {
    return this.meshBox(obj).getCenter(new THREE.Vector3());
  }

  /** A comfortable viewing distance for this object (scene units). */
  private closeDistance(obj: THREE.Object3D) {
    const size = this.meshBox(obj).getSize(new THREE.Vector3()).length();
    return Math.max(18, size * 1.6);
  }

  private offsetFor(mode: FollowMode, obj: THREE.Object3D, center: THREE.Vector3): THREE.Vector3 | null {
    const { camera } = this.d;
    const dist = this.closeDistance(obj);
    switch (mode) {
      case "free":
        return null;
      case "close": {
        const dir = camera.position.clone().sub(center);
        if (dir.lengthSq() < 1e-6) dir.set(1, 0.5, 1);
        return dir.normalize().multiplyScalar(dist);
      }
      case "chase":
        return this.heading.clone().multiplyScalar(-dist * 1.3).add(new THREE.Vector3(0, dist * 0.45, 0));
      case "top": {
        // a hair of horizontal offset keeps OrbitControls off the exact pole
        const h = camera.position.clone().sub(center).setY(0);
        if (h.lengthSq() < 1e-6) h.set(0, 0, 1);
        return h.normalize().multiplyScalar(dist * 0.02).add(new THREE.Vector3(0, dist * 3, 0));
      }
    }
  }

  // ------------------------------------------------------------------ chip

  private buildChip() {
    const chip = document.createElement("div");
    chip.className = "follow-chip";
    chip.hidden = true;
    chip.setAttribute("role", "toolbar");
    chip.setAttribute("aria-label", "Camera follow");
    chip.innerHTML = `
      <span class="follow-chip-dot" aria-hidden="true"></span>
      <span class="follow-chip-name"></span>
      <span class="follow-chip-modes">${FOLLOW_MODES.map(
        (m) => `<button type="button" data-mode="${m.mode}" title="${m.hint}">${m.mode === "free" ? "Free" : m.label}</button>`,
      ).join("")}</span>
      <button type="button" class="follow-chip-stop" title="Stop following (Esc)" aria-label="Stop following">✕</button>`;
    chip.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) =>
      b.addEventListener("click", () => this.setMode(b.dataset.mode as FollowMode)),
    );
    chip.querySelector(".follow-chip-stop")!.addEventListener("click", () => this.stop());
    this.d.viewport.appendChild(chip);
    return chip;
  }

  private renderChip() {
    this.chip.hidden = !this.target;
    if (!this.target) return;
    (this.chip.querySelector(".follow-chip-name") as HTMLElement).textContent = `Following ${this.name ?? "object"}`;
    this.chip.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => {
      const on = b.dataset.mode === this.mode;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }
}

// ---------------------------------------------------------------------- click menu

export interface PickMenuItem {
  label: string;
  hint?: string;
  key?: string;
  action: () => void;
  danger?: boolean;
  active?: boolean;
}

let menuEl: HTMLElement | null = null;
let menuCleanup: (() => void) | null = null;

export function closePickMenu() {
  menuCleanup?.();
  menuCleanup = null;
  menuEl?.remove();
  menuEl = null;
}

export function isPickMenuOpen() {
  return !!menuEl;
}

/** A small menu at the click point (client coords), kept inside `container`. */
export function showPickMenu(
  container: HTMLElement,
  at: { x: number; y: number },
  title: string,
  items: Array<PickMenuItem | "sep">,
) {
  closePickMenu();
  const el = document.createElement("div");
  el.className = "pick-menu";
  el.setAttribute("role", "menu");
  const h = document.createElement("div");
  h.className = "pick-menu-title";
  h.textContent = title;
  el.appendChild(h);
  const buttons: HTMLButtonElement[] = [];
  items.forEach((it) => {
    if (it === "sep") {
      el.appendChild(Object.assign(document.createElement("hr"), {}));
      return;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    if (it.danger) b.classList.add("is-danger");
    if (it.active) b.classList.add("is-active");
    b.innerHTML = `<span></span>${it.key ? `<kbd>${it.key}</kbd>` : ""}`;
    (b.firstChild as HTMLElement).textContent = it.label;
    if (it.hint) b.title = it.hint;
    b.addEventListener("click", () => {
      closePickMenu();
      it.action();
    });
    el.appendChild(b);
    buttons.push(b);
  });
  container.appendChild(el);

  // place it beside the pointer, flipped to stay inside the viewport
  const r = container.getBoundingClientRect();
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  let x = at.x - r.left + 8;
  let y = at.y - r.top + 8;
  if (x + w > r.width - 4) x = Math.max(4, at.x - r.left - w - 8);
  if (y + hgt > r.height - 4) y = Math.max(4, r.height - hgt - 4);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  menuEl = el;

  const onDown = (e: PointerEvent) => {
    if (!el.contains(e.target as Node)) closePickMenu();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closePickMenu();
      return;
    }
    const hit = items.find((it): it is PickMenuItem => it !== "sep" && !!it.key && it.key.toLowerCase() === e.key.toLowerCase());
    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      closePickMenu();
      hit.action();
    }
  };
  const onWheel = () => closePickMenu();
  // next tick, so the click that opened it doesn't close it
  const t = window.setTimeout(() => {
    document.addEventListener("pointerdown", onDown, true);
    container.addEventListener("wheel", onWheel, { passive: true });
  }, 0);
  document.addEventListener("keydown", onKey, true);
  menuCleanup = () => {
    window.clearTimeout(t);
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    container.removeEventListener("wheel", onWheel);
  };
  buttons[0]?.focus({ preventScroll: true });
}
