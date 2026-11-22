// Plane selector strip at the top of Plane Settings (specs/formation-jumps.md §10.2).

import type { SimJumper, SimPlane } from "../classes/SimEntities";
import { AIRCRAFT, AIRCRAFT_ORDER, AircraftId } from "../fleet/Aircraft";
import { FLEET_LAYOUTS, FLEET_LAYOUT_ORDER, Fleet, FleetLayoutId, MAX_PLANES } from "../fleet/Fleet";
import { notificationManager } from "../classes/NotificationManager";

export const ALL_PLANES = "all";

export interface StripHost {
  selectedPlaneId: string;
  selectPlane(id: string): void;
  /** Something changed that needs a recalculation and a redraw. */
  changed(): void;
}

const M_TO_FT = 3.28084;
const hex = (c: number) => `#${(c || 0xffd700).toString(16).padStart(6, "0")}`;

export function renderPlaneStrip(host: StripHost, fleet: Fleet, jumpers: SimJumper[]) {
  const strip = document.getElementById("plane-strip");
  if (!strip) return;
  strip.replaceChildren();
  const planes = fleet.planes;

  planes.forEach((p, k) => {
    const seats = fleet.seats(p, jumpers);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "ps-plane-chip";
    chip.setAttribute("role", "tab");
    const active = host.selectedPlaneId === p.id;
    chip.setAttribute("aria-selected", String(active));
    chip.classList.toggle("is-active", active);
    chip.classList.toggle("is-over", seats.over);
    chip.dataset.id = p.id;
    chip.title = `${p.label}${k === 0 ? " (lead)" : ""} · ${AIRCRAFT[p.aircraftId].name} · ${seats.used}${seats.capacity ? ` of ${seats.capacity}` : ""} seats${seats.over ? " · over capacity" : ""}. Right-click for options.`;
    const dot = document.createElement("span");
    dot.className = "ps-plane-dot";
    dot.style.background = hex(p.planeColor);
    const name = document.createElement("span");
    name.className = "ps-plane-name";
    name.textContent = `${k + 1} ${p.label}`;
    const kind = document.createElement("span");
    kind.className = "ps-plane-kind";
    kind.textContent = AIRCRAFT[p.aircraftId].shortName;
    const seat = document.createElement("span");
    seat.className = "ps-plane-seats";
    seat.textContent = `${seats.over ? "⚠ " : ""}${seats.used}/${seats.capacity ?? "—"}`;
    const more = document.createElement("span");
    more.className = "ps-plane-more";
    more.textContent = "⋯";
    more.title = "Plane options";
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      openPlaneMenu(host, fleet, p, more);
    });
    chip.append(dot, name, kind, seat, more);
    chip.addEventListener("click", () => host.selectPlane(p.id));
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openPlaneMenu(host, fleet, p, chip);
    });
    strip.appendChild(chip);
  });

  const add = document.createElement("button");
  add.type = "button";
  add.className = "ps-plane-add";
  add.textContent = "＋";
  add.title = planes.length >= MAX_PLANES ? `At most ${MAX_PLANES} planes` : "Add a plane";
  add.disabled = planes.length >= MAX_PLANES;
  add.addEventListener("click", () => {
    const p = fleet.addPlane(fleet.lead.aircraftId);
    host.selectPlane(p.id);
    host.changed();
  });
  strip.appendChild(add);

  const all = document.createElement("button");
  all.type = "button";
  all.className = "ps-plane-chip ps-plane-all";
  all.setAttribute("role", "tab");
  all.setAttribute("aria-selected", String(host.selectedPlaneId === ALL_PLANES));
  all.classList.toggle("is-active", host.selectedPlaneId === ALL_PLANES);
  all.textContent = `All ${jumpers.length}`;
  all.title = "Every jumper, with a Plane column to move them";
  all.addEventListener("click", () => host.selectPlane(ALL_PLANES));
  strip.appendChild(all);

  if (planes.length > 1) {
    const spacer = document.createElement("span");
    spacer.className = "ps-strip-spacer";
    strip.appendChild(spacer);
    const sel = document.createElement("select");
    sel.className = "ps-select";
    sel.title = "How the planes fly together";
    FLEET_LAYOUT_ORDER.forEach((id) => {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = FLEET_LAYOUTS[id];
      o.selected = id === fleet.layout;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => {
      fleet.setLayout(sel.value as FleetLayoutId);
      host.changed();
    });
    const gear = document.createElement("button");
    gear.type = "button";
    gear.className = "ps-btn ps-gear";
    gear.textContent = "⚙";
    gear.title = "Plane spacing and go offsets";
    gear.addEventListener("click", () => openSpacing(host, fleet, gear));
    strip.append(sel, gear);
  }

  // keyboard: ←/→ between chips
  strip.onkeydown = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const tabs = [...strip.querySelectorAll<HTMLElement>('[role="tab"]')];
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    e.preventDefault();
    next.click();
    requestAnimationFrame(() => strip.querySelector<HTMLElement>(`[data-id="${next.dataset.id ?? ""}"]`)?.focus() ?? next.focus());
  };
  const warn = fleet.overlaps().map(([a, b]) => `${a.label} and ${b.label} overlap`);
  strip.title = warn.length ? `⚠ ${warn.join("; ")}` : "";
}

function popover(anchor: HTMLElement): HTMLDivElement {
  document.querySelector(".ps-popover")?.remove();
  const pop = document.createElement("div");
  pop.className = "ps-popover";
  document.body.appendChild(pop);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left))}px`;
    pop.style.top = `${Math.max(8, r.top - pop.offsetHeight - 6)}px`;
  };
  requestAnimationFrame(place);
  const close = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node) && e.target !== anchor) {
      pop.remove();
      document.removeEventListener("mousedown", close, true);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", close, true), 0);
  return pop;
}

function menuItem(pop: HTMLElement, label: string, fn: () => void, disabled = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ps-menu-item";
  b.textContent = label;
  b.disabled = disabled;
  b.addEventListener("click", () => {
    pop.remove();
    fn();
  });
  pop.appendChild(b);
}

function openPlaneMenu(host: StripHost, fleet: Fleet, p: SimPlane, anchor: HTMLElement) {
  const pop = popover(anchor);
  pop.classList.add("ps-menu");
  const k = fleet.planes.indexOf(p);
  menuItem(pop, "Rename…", () => {
    const name = window.prompt("Plane name", p.label);
    if (name && name.trim()) {
      p.label = name.trim().slice(0, 40);
      host.changed();
    }
  });
  const h = document.createElement("h4");
  h.textContent = "Aircraft";
  pop.appendChild(h);
  AIRCRAFT_ORDER.forEach((id: AircraftId) =>
    menuItem(pop, `${id === p.aircraftId ? "● " : "  "}${AIRCRAFT[id].name}`, () => {
      fleet.setAircraft(p, id);
      host.changed();
    }),
  );
  pop.appendChild(document.createElement("hr"));
  menuItem(pop, "Make lead", () => {
    fleet.setLead(p);
    host.changed();
  }, k === 0);
  menuItem(pop, "Move left", () => {
    fleet.movePlane(p, -1);
    host.changed();
  }, k === 0);
  menuItem(pop, "Move right", () => {
    fleet.movePlane(p, 1);
    host.changed();
  }, k === fleet.planes.length - 1);
  menuItem(pop, "Remove plane…", () => removePlane(host, fleet, p), fleet.planes.length <= 1);
}

function removePlane(host: StripHost, fleet: Fleet, p: SimPlane) {
  const all: SimJumper[] = (window as any).simJumpers ?? [];
  const aboard = fleet.jumpersOf(p, all);
  const others = fleet.planes.filter((x) => x !== p);
  const free = others.reduce((s, x) => s + Math.max(0, (x.capacity ?? Infinity) - fleet.seats(x, all).used), 0);
  const msg = aboard.length
    ? free >= aboard.length
      ? `Remove ${p.label}? Its ${aboard.length} jumpers move to the other planes.`
      : `Remove ${p.label}? The other planes only have ${free} free seats for its ${aboard.length} jumpers; they'll be over capacity.`
    : `Remove ${p.label}?`;
  if (!window.confirm(msg)) return;
  fleet.removePlane(p);
  // fill the other planes' free seats in order, then the lead
  for (const j of aboard) {
    const to = others.find((x) => (x.capacity ?? Infinity) > fleet.seats(x, all).used) ?? fleet.lead;
    fleet.moveJumper(j, to);
  }
  fleet.reindex(all);
  if (host.selectedPlaneId === p.id) host.selectPlane(fleet.lead.id);
  host.changed();
  notificationManager.info(`Removed ${p.label}.`);
}

function openSpacing(host: StripHost, fleet: Fleet, anchor: HTMLElement) {
  const pop = popover(anchor);
  const s = fleet.spacing;
  pop.innerHTML = `
    <h4>Spacing per row</h4>
    <label title="How far behind the plane ahead">Back (m)<input type="number" step="5" min="0" data-s="backM" value="${Number(s.backM)}"></label>
    <label title="How far out to the side">Sideways (m)<input type="number" step="5" min="0" data-s="rightM" value="${Number(s.rightM)}"></label>
    <label title="How much higher than the plane ahead">Step up (m)<input type="number" step="5" min="0" data-s="upM" value="${Number(s.upM)}"></label>
    <h4>Go offset (s)</h4>
    <div class="ps-go"></div>`;
  pop.querySelectorAll<HTMLInputElement>("[data-s]").forEach((el) =>
    el.addEventListener("change", () => {
      const v = Number(el.value);
      if (!Number.isFinite(v) || v < 0) return;
      (fleet.spacing as any)[el.dataset.s!] = v;
      fleet.applyLayout();
      host.changed();
    }),
  );
  const go = pop.querySelector(".ps-go")!;
  fleet.planes.slice(1).forEach((p) => {
    const l = document.createElement("label");
    l.textContent = p.label;
    l.title = `${Math.round(p.offset.backM)} m back · ${Math.round(p.offset.rightM)} m right · +${Math.round(p.offset.upM * M_TO_FT)} ft`;
    const i = document.createElement("input");
    i.type = "number";
    i.step = "0.5";
    i.value = String(p.goOffsetS);
    i.addEventListener("change", () => {
      const v = Number(i.value);
      if (!Number.isFinite(v)) return;
      p.goOffsetS = Math.max(-10, Math.min(30, v));
      host.changed();
    });
    l.appendChild(i);
    go.appendChild(l);
  });
}
